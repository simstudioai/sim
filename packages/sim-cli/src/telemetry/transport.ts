import { type ChildProcess, spawn } from 'node:child_process'
import { childProcessEnv, proxyExecArgv } from '../environment'

/**
 * Where events go. The key is a PostHog project token — a public, write-only
 * value — baked into the published build by `bun build --env='SIM_CLI_TELEMETRY_*'`
 * the way the Supabase CLI injects its own at link time. A checkout built
 * without one has no destination and reports nothing, and a self-hosted
 * deployment can point its own build at its own project.
 *
 * These two reads must stay literal `process.env.<NAME>` expressions: that is
 * the only form the bundler substitutes.
 */
const BUILT_IN_KEY = process.env.SIM_CLI_TELEMETRY_KEY
const BUILT_IN_HOST = process.env.SIM_CLI_TELEMETRY_HOST

export const DEFAULT_INGEST_HOST = 'https://us.i.posthog.com'

/** The single-event capture endpoint, relative to the ingest host. */
const CAPTURE_PATH = '/i/v0/e/'

/**
 * How long the sender may take. Generous for a request that carries a kilobyte,
 * and irrelevant to the user, who has already got their prompt back.
 */
const SEND_TIMEOUT_MS = 5000

/** Carries the request into the sender process; not part of the bundled build's env glob. */
const PAYLOAD_VARIABLE = 'SIM_TELEMETRY_CAPTURE'

export interface IngestTarget {
  key: string
  host: string
}

/** The destination this build was made with, if any. */
export function builtInIngestTarget(): IngestTarget | undefined {
  if (!BUILT_IN_KEY) return undefined
  return { key: BUILT_IN_KEY, host: BUILT_IN_HOST || DEFAULT_INGEST_HOST }
}

/** One event in the shape PostHog's capture endpoint accepts. */
export interface CaptureRequest<Properties extends object = Record<string, unknown>> {
  api_key: string
  event: string
  distinct_id: string
  timestamp: string
  properties: Properties
}

const SEND_SCRIPT = `
try {
  const { url, body, timeoutMs } = JSON.parse(process.env[${JSON.stringify(PAYLOAD_VARIABLE)}])
  const deadline = setTimeout(() => process.exit(1), timeoutMs)
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    redirect: 'error',
  })
  clearTimeout(deadline)
  process.exit(0)
} catch {
  process.exit(1)
}
`

export type SpawnSender = (
  command: string,
  args: readonly string[],
  options: { detached: boolean; env: NodeJS.ProcessEnv; stdio: 'ignore'; windowsHide: boolean }
) => Pick<ChildProcess, 'unref' | 'once'>

/**
 * Sends one event from a process whose lifetime is its own.
 *
 * The command has finished and the user has their prompt back; nothing about
 * delivery should change that. An in-process request would keep the event loop
 * alive for as long as the network took to answer — a DNS lookup on a dead
 * network cannot be cancelled at all — so the request is made by a detached
 * child that the parent does not wait for, the way the GitHub and Vercel CLIs
 * send theirs. The child bounds its own life with a deadline. The request
 * travels in the child's environment rather than on argv because the
 * environment is handed over at spawn time, so the parent can exit at once
 * without a pipe left half-written.
 */
export function sendCapture(
  target: IngestTarget,
  request: CaptureRequest<object>,
  spawnSender: SpawnSender = spawn
): void {
  const payload = JSON.stringify({
    url: new URL(CAPTURE_PATH, target.host).href,
    body: JSON.stringify(request),
    timeoutMs: SEND_TIMEOUT_MS,
  })
  try {
    const child = spawnSender(
      process.execPath,
      [...proxyExecArgv(), '--input-type=module', '--eval', SEND_SCRIPT],
      {
        detached: true,
        env: childProcessEnv(['sim_api_key'], { [PAYLOAD_VARIABLE]: payload }),
        stdio: 'ignore',
        windowsHide: true,
      }
    )
    child.once('error', () => {})
    child.unref()
  } catch {
    /** A sender that could not start is an event not worth the command noticing. */
  }
}
