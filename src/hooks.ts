import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Store } from './store.js';

export interface HookInput {
  event_id: string;
  event_name: 'SessionStart' | 'Stop' | 'SessionEnd';
  session_id: string;
  cwd?: string;
  at?: string;
}

function field(input: Record<string, unknown>, name: string, max = 4096): string | undefined {
  const value = input[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error('Invalid hook metadata');
  }
  return value;
}

/** Allowlist metadata: never persist transcripts, model output, or the raw payload. */
export function normalizeHook(value: unknown): HookInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid hook payload');
  const input = value as Record<string, unknown>;
  const event = field(input, 'hook_event_name', 64);
  if (event !== 'SessionStart' && event !== 'Stop' && event !== 'SessionEnd') throw new Error('Unsupported hook event');
  const session = field(input, 'session_id', 256);
  if (!session) throw new Error('Missing session identifier');
  const cwd = field(input, 'cwd');
  const turn = field(input, 'turn_id', 256);
  const at = field(input, 'timestamp', 64) ?? field(input, 'at', 64);
  if (at && !Number.isFinite(Date.parse(at))) throw new Error('Invalid hook timestamp');
  const explicitId = field(input, 'event_id', 256);
  const eventId = explicitId ?? (turn || at
    ? createHash('sha256').update(JSON.stringify([event, session, cwd ?? null, turn ?? null, at ?? null])).digest('hex')
    : randomUUID());
  return { event_id: eventId, event_name: event, session_id: session, ...(cwd ? { cwd } : {}), ...(at ? { at } : {}) };
}

export async function readPayload(stream: AsyncIterable<Uint8Array | string>, maxBytes = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error('Hook payload exceeds limit');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid hook JSON'); }
}

async function main(): Promise<void> {
  let store: Store | undefined;
  try {
    const input = normalizeHook(await readPayload(process.stdin));
    store = new Store(process.env.TASK_WORKSPACE_HOME);
    store.ingestHook(input);
    // Empty stdout avoids injecting content or controlling the host's turn.
  } catch {
    // Do not echo payloads or database error messages that could contain private data.
    process.stderr.write('Task Workspace: hook collection failed; inspect Hook Health and local configuration.\n');
    process.exitCode = 1; // Never exit 2: Stop treats it as a continuation request.
  } finally {
    try { store?.close(); } catch {
      process.stderr.write('Task Workspace: hook storage cleanup failed.\n');
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
