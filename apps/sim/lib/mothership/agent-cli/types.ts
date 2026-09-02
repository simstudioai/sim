/**
 * Sim's half of the mothership↔CLI translation layer: generic execution PRIMITIVES.
 * The worker owns the grammar (what commands exist, how argv parses, pipes, help, the
 * card); this side only executes typed requests. Nothing here parses argv tokens,
 * matches command names, or interprets flags — that is enforced by
 * scripts/check-agent-cli-boundary.ts.
 *
 * Engines reuse the v2 surface through the CLI's own typed client — same identity,
 * same authorization — and transform typed responses. They never re-parse rendered CLI
 * output, and they never grow a new data-access path: anything v2 cannot answer gets an
 * internal application call added here, not a v2 change.
 */

/** The one client capability engines use; SimClient satisfies it structurally. */
export interface AgentCliClient {
  request<T>(path: string, options?: { query?: Record<string, string> }): Promise<T>
}

export interface AgentCliRuntime {
  client: AgentCliClient
  workspaceId: string
  /** The human the command acts as — reference resolution and grants scope to them. */
  userId: string
}

export interface AgentCliResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Command-local flags exactly as the worker parsed them: strings, or true for bare flags. */
export type AgentCliFlags = Readonly<Record<string, string | true>>

/** One augmentation's execution, keyed in engines/index.ts by the worker's canonical name. */
export interface AgentCliEngine {
  execute(
    positionals: string[],
    runtime: AgentCliRuntime,
    flags: AgentCliFlags
  ): Promise<AgentCliResult>
}

export function agentCliOk(stdout: string): AgentCliResult {
  return { exitCode: 0, stdout, stderr: '' }
}

export function agentCliFail(message: string): AgentCliResult {
  return { exitCode: 1, stdout: '', stderr: `Error: ${message}` }
}
