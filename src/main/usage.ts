import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  UsageBucket,
  UsageCacheStats,
  UsageDay,
  UsageDeviation,
  UsageModelRow,
  UsagePerModel,
  UsageProviderRow,
  UsageStats,
  UsageTotals,
} from "@shared/types";

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, reasoning: 0 };
}

function addTotals(target: UsageTotals, source: Partial<UsageTotals>): void {
  target.input += source.input ?? 0;
  target.output += source.output ?? 0;
  target.cacheRead += source.cacheRead ?? 0;
  target.cacheWrite += source.cacheWrite ?? 0;
  target.total += source.total ?? 0;
  target.cost += source.cost ?? 0;
  target.reasoning += source.reasoning ?? 0;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

interface UsageSample {
  timestamp: number;
  provider: string;
  providerName: string;
  model: string;
  usage: UsageTotals;
  sessionPath: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsage(message: Record<string, unknown>): UsageTotals {
  const usage = asRecord(message.usage);
  const cost = asRecord(usage.cost);
  const input = num(usage.input);
  const output = num(usage.output);
  const cacheRead = num(usage.cacheRead);
  const cacheWrite = num(usage.cacheWrite);
  const total = num(usage.totalTokens) || input + output + cacheRead + cacheWrite;
  const reasoning = num(usage.reasoning);
  // reasoning tokens are already billed inside output for most providers
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    cost: num(cost.total),
    reasoning,
  };
}

async function scanSessionFile(filePath: string, samples: UsageSample[]): Promise<number> {
  const rl = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  let provider = "";
  let model = "";
  let count = 0;
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: Record<string, unknown>;
      try {
        entry = asRecord(JSON.parse(trimmed));
      } catch {
        continue;
      }
      const type = entry.type;
      if (type === "model_change") {
        provider = typeof entry.provider === "string" ? entry.provider : provider;
        model = typeof entry.modelId === "string" ? entry.modelId : model;
        continue;
      }
      if (type !== "message") continue;
      const message = asRecord(entry.message);
      if (message.role !== "assistant") continue;
      const hasUsage = message.usage !== undefined;
      if (!hasUsage) continue;
      const stamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Date.now();
      const usage = readUsage(message);
      if (!usage.total && !usage.input && !usage.output) continue;
      samples.push({
        timestamp: Number.isFinite(stamp) ? stamp : Date.now(),
        provider: (typeof message.provider === "string" && message.provider) || provider || "unknown",
        providerName: "",
        model: (typeof message.model === "string" && message.model) || model || "unknown",
        usage,
        sessionPath: filePath,
      });
      count += 1;
    }
  } finally {
    rl.close();
  }
  return count;
}

function listSessionFiles(rootDir: string, extraDir?: string): string[] {
  const roots = [rootDir];
  if (extraDir && extraDir !== rootDir && existsSync(extraDir)) roots.push(extraDir);
  const files: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let dirs: string[] = [];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const dirPath = join(root, dir);
      let stat;
      try {
        stat = statSync(dirPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      let entries: string[] = [];
      try {
        entries = readdirSync(dirPath);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) files.push(join(dirPath, entry));
      }
    }
  }
  return files;
}

function currentStreak(activeDays: Set<string>): number {
  let streak = 0;
  const cursor = new Date();
  // allow today to be empty without breaking the streak
  if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function longestStreak(activeDays: Set<string>): number {
  const sorted = [...activeDays].sort();
  let best = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const day of sorted) {
    const date = new Date(`${day}T00:00:00`);
    if (previous && (date.getTime() - previous.getTime()) / 86_400_000 === 1) run += 1;
    else run = 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

export async function collectUsage(options?: { days?: number; sessionDir?: string; cwd?: string }): Promise<UsageStats> {
  const agentDir = getAgentDir();
  const errors: string[] = [];
  const samples: UsageSample[] = [];
  const files = listSessionFiles(join(agentDir, "sessions"), options?.sessionDir);
  let messageCount = 0;

  for (const file of files) {
    try {
      messageCount += await scanSessionFile(file, samples);
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const days = options?.days ?? 0;
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const scoped = samples.filter((sample) => sample.timestamp >= cutoff);

  const totals = emptyTotals();
  const dayMap = new Map<string, UsageDay>();
  const hourBuckets = new Array(24).fill(0) as number[];
  const modelMap = new Map<string, { row: UsageModelRow; samples: number[] }>();
  const providerMap = new Map<string, UsageProviderRow>();
  const activeDays = new Set<string>();
  const sessions = new Set<string>();
  const modelTokens = new Map<string, number>();
  const bucketMap = new Map<string, UsageBucket>();

  for (const sample of scoped) {
    const { usage } = sample;
    addTotals(totals, usage);
    const date = new Date(sample.timestamp);
    const key = dayKey(date);
    activeDays.add(key);
    sessions.add(sample.sessionPath);

    const bucketKey = `${key}|${date.getHours()}|${sample.provider}|${sample.model}`;
    const bucket = bucketMap.get(bucketKey) ?? {
      date: key,
      hour: date.getHours(),
      provider: sample.provider,
      providerName: sample.providerName || sample.provider,
      model: sample.model,
      calls: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      cost: 0,
    };
    bucket.calls += 1;
    bucket.input += usage.input;
    bucket.output += usage.output;
    bucket.cacheRead += usage.cacheRead;
    bucket.cacheWrite += usage.cacheWrite;
    bucket.total += usage.total;
    bucket.cost += usage.cost;
    bucketMap.set(bucketKey, bucket);

    const day = dayMap.get(key) ?? {
      date: key,
      calls: 0,
      tokens: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cost: 0,
    };
    day.calls += 1;
    day.tokens += usage.total;
    day.input += usage.input;
    day.output += usage.output;
    day.cacheRead += usage.cacheRead;
    day.cost += usage.cost;
    dayMap.set(key, day);

    hourBuckets[date.getHours()] += usage.total;

    const modelKey = `${sample.provider}/${sample.model}`;
    const existing = modelMap.get(modelKey);
    if (existing) {
      addTotals(existing.row, usage);
      existing.row.calls += 1;
      existing.samples.push(usage.total);
      existing.row.firstUsed = new Date(Math.min(Date.parse(existing.row.firstUsed), sample.timestamp)).toISOString();
      existing.row.lastUsed = new Date(Math.max(Date.parse(existing.row.lastUsed), sample.timestamp)).toISOString();
    } else {
      const row: UsageModelRow = {
        provider: sample.provider,
        providerName: sample.providerName || sample.provider,
        model: sample.model,
        calls: 1,
        cacheRate: 0,
        firstUsed: new Date(sample.timestamp).toISOString(),
        lastUsed: new Date(sample.timestamp).toISOString(),
        medianTokensPerCall: 0,
        ...emptyTotals(),
      };
      addTotals(row, usage);
      modelMap.set(modelKey, { row, samples: [usage.total] });
    }
    modelTokens.set(modelKey, (modelTokens.get(modelKey) ?? 0) + usage.total);

    const provider = providerMap.get(sample.provider) ?? {
      provider: sample.provider,
      providerName: sample.providerName || sample.provider,
      calls: 0,
      models: 0,
      cacheRate: 0,
      ...emptyTotals(),
    };
    provider.calls += 1;
    addTotals(provider, usage);
    providerMap.set(sample.provider, provider);
  }

  const models = [...modelMap.values()].map(({ row, samples: values }) => {
    const fresh = row.input + row.cacheRead;
    row.cacheRate = fresh > 0 ? row.cacheRead / fresh : 0;
    row.medianTokensPerCall = median(values);
    return row;
  });
  models.sort((a, b) => b.total - a.total);

  const providerModelCount = new Map<string, Set<string>>();
  for (const model of models) {
    const set = providerModelCount.get(model.provider) ?? new Set<string>();
    set.add(model.model);
    providerModelCount.set(model.provider, set);
  }
  const providers = [...providerMap.values()].map((provider) => {
    const fresh = provider.input + provider.cacheRead;
    provider.cacheRate = fresh > 0 ? provider.cacheRead / fresh : 0;
    provider.models = providerModelCount.get(provider.provider)?.size ?? 0;
    return provider;
  });
  providers.sort((a, b) => b.total - a.total);

  const cacheByChannel: UsagePerModel[] = models.map((model) => {
    const fresh = model.input + model.cacheRead;
    return {
      provider: model.provider,
      providerName: model.providerName,
      model: model.model,
      calls: model.calls,
      cacheHitRate: fresh > 0 ? model.cacheRead / fresh : 0,
      tokens: model.total,
      cacheRead: model.cacheRead,
      cacheWrite: model.cacheWrite,
    };
  });

  const cache: UsageCacheStats = {
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    freshInput: totals.input,
    hitRate: totals.input + totals.cacheRead > 0 ? totals.cacheRead / (totals.input + totals.cacheRead) : 0,
    savedTokens: totals.cacheRead,
    byModel: cacheByChannel,
  };

  const dayList = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const deviations: UsageDeviation[] = dayList.map((day) => {
    const daily = scoped.filter((sample) => dayKey(new Date(sample.timestamp)) === day.date);
    const fresh = day.input + day.cacheRead;
    return {
      date: day.date,
      tokens: day.tokens,
      calls: day.calls,
      cacheRate: fresh > 0 ? day.cacheRead / fresh : 0,
      cost: day.cost,
    };
  });

  const peakHour = hourBuckets.some((value) => value > 0)
    ? hourBuckets.indexOf(Math.max(...hourBuckets))
    : null;

  const favorite = [...modelTokens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const timestamps = scoped.map((sample) => sample.timestamp);

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
      to: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
      days,
    },
    totals,
    kpis: {
      sessions: sessions.size,
      messages: messageCount,
      activeDays: activeDays.size,
      currentStreak: currentStreak(activeDays),
      longestStreak: longestStreak(activeDays),
      peakHour,
      favoriteModel: favorite,
    },
    days: dayList,
    hours: hourBuckets,
    models,
    providers,
    cache,
    cacheByChannel,
    deviations,
    buckets: [...bucketMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour),
    sessionCount: sessions.size,
    messageCount,
    scannedFiles: files.length,
    errors,
  };
}

/** Quick session counts used by the sidebar badges without a full usage scan. */
export async function countProjectSessions(cwd: string): Promise<number> {
  try {
    const sessions = await SessionManager.list(cwd);
    return sessions.length;
  } catch {
    return 0;
  }
}
