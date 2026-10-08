/** Every keyless response is streamed through these helpers so a hostile or
 * broken endpoint cannot exhaust memory before the parser sees a byte. */

export async function readBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error("The server returned an empty response.");
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new Error(responseTooLarge(maxBytes));
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(responseTooLarge(maxBytes));
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function responseTooLarge(maxBytes: number): string {
  return `The response exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB; narrow the request.`;
}

/** Content-Type charset first, UTF-8 fallback. Node ships full ICU, so legacy
 * charsets (gbk, big5, shift_jis) decode without a dependency. */
export function decodeBytes(bytes: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)?.[1];
  if (charset && charset.toLowerCase() !== "utf-8") {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown or unsupported label: fall through to UTF-8.
    }
  }
  return bytes.toString("utf8");
}
