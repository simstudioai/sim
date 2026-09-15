import { CLIENT_INFO_HEADER, formatClientInfo } from '@sim/utils/client-info'
import { CLI_VERSION, USER_AGENT } from '../version'
import { detectCodingAgent, NO_CODING_AGENT } from './coding-agent'
import { telemetryStatus } from './policy'
import { loadTelemetryState } from './state'

/** The process's own value; an explicit environment (tests) is never cached. */
let cached: string | undefined

/**
 * The `X-Sim-Client-Info` value: the same facts as the user agent, in the
 * header every official client sends, plus the AI coding agent driving this
 * shell (`none` when none is detected). The server reads this header, not the user
 * agent, so a request from the CLI is attributed to the CLI on every log line
 * and analytics event it produces.
 *
 * The agent is usage data, so it goes only where usage reporting is allowed:
 * `DO_NOT_TRACK`, `SIM_TELEMETRY_DISABLED`, and `sim telemetry disable` all
 * withhold it. Whether this build has a reporting destination is irrelevant —
 * the server, not the CLI, is what records it. Computed once per process.
 */
export function clientInfoHeader(env: NodeJS.ProcessEnv = process.env): string {
  if (env !== process.env) return buildClientInfoHeader(env)
  cached ??= buildClientInfoHeader(env)
  return cached
}

/**
 * The headers that identify the CLI on every request it makes to a Sim
 * deployment: the user agent and `X-Sim-Client-Info`. One definition, so the
 * API client and the login flows cannot drift into identifying themselves
 * differently.
 */
export function identityHeaders(): Record<string, string> {
  return { 'user-agent': USER_AGENT, [CLIENT_INFO_HEADER]: clientInfoHeader() }
}

function buildClientInfoHeader(env: NodeJS.ProcessEnv): string {
  return formatClientInfo({
    surface: 'cli',
    version: CLI_VERSION,
    runtime: { name: 'node', version: process.versions.node },
    os: process.platform,
    arch: process.arch,
    ...(reportingAllowed(env) ? { agent: detectCodingAgent(env) ?? NO_CODING_AGENT } : {}),
  })
}

function reportingAllowed(env: NodeJS.ProcessEnv): boolean {
  return telemetryStatus({ env, state: loadTelemetryState(), configured: true }).enabled
}
