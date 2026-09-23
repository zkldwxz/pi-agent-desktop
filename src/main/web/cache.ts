type Entry<T> = { value: T; expires: number; bytes: number };
type Pending<T> = { controller: AbortController; promise: Promise<T>; users: number };

/** TTL + LRU, bounded by both entry count and bytes. Errors are never retained. */
export class RequestCache<T> {
  private entries = new Map<string, Entry<T>>();
  private pending = new Map<string, Pending<T>>();
  private bytes = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly sizeOf: (value: T) => number,
    private readonly now = Date.now,
  ) {}

  peek(key: string): T | undefined {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  async get(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ value: T; cache: "hit" | "miss" | "shared" }> {
    options.signal?.throwIfAborted();
    const cached = this.peek(key);
    // During refresh, join the fresh operation instead of serving an older entry.
    let pending = this.pending.get(key);
    if (pending?.controller.signal.aborted) pending = undefined;
    if (!pending && !options.refresh && cached !== undefined) return { value: cached, cache: "hit" };
    const shared = Boolean(pending);
    if (!pending) {
      const controller = new AbortController();
      const item: Pending<T> = { controller, users: 0, promise: undefined! };
      item.promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(controller.signal);
      }).then((value) => {
        controller.signal.throwIfAborted();
        this.store(key, value);
        return value;
      }).finally(() => {
        if (this.pending.get(key) === item) this.pending.delete(key);
      });
      pending = item;
      this.pending.set(key, pending);
    }
    const operation = pending;
    operation.users++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (done: () => void) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", abort);
        operation.users--;
        if (operation.users === 0) operation.controller.abort();
        done();
      };
      const abort = () => finish(() => reject(options.signal?.reason ?? new Error("Request cancelled")));
      options.signal?.addEventListener("abort", abort, { once: true });
      operation.promise.then(
        (value) => finish(() => resolve({ value, cache: shared ? "shared" : "miss" })),
        (error) => finish(() => reject(error)),
      );
      if (options.signal?.aborted) abort();
    });
  }

  private store(key: string, value: T): void {
    this.prune();
    this.remove(key);
    const bytes = this.sizeOf(value);
    if (bytes > this.maxBytes) throw new Error("Web result exceeds the cache capacity; narrow the request.");
    this.entries.set(key, { value, bytes, expires: this.now() + this.ttlMs });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      this.remove(this.entries.keys().next().value!);
    }
  }

  private prune(): void {
    for (const [key, value] of this.entries) if (value.expires <= this.now()) this.remove(key);
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
}
