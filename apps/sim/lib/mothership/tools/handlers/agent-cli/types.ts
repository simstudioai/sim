/**
 * Agent-only CLI augmentations: commands the mothership agent sees alongside
 * the real Sim CLI, exposing views the product CLI has no reason to carry
 * (workflow-scoped grep, edges/blocks projections, cross-workflow search).
 *
 * Each augmentation reuses the v2 surface through the CLI's own typed client —
 * same identity, same authorization — and transforms typed responses. It never
 * re-parses rendered CLI output, and it never grows a new data-access path:
 * anything v2 cannot answer gets an internal application call added here, not
 * a v2 change.
 */

/** The one client capability augmentations use; SimClient satisfies it structurally. */
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

export interface AgentCliCommand {
  /** argv tokens that select this command, matched as a prefix (e.g. ['workflow', 'edges']). */
  path: readonly string[]
  /** One line for the merged --help section. */
  summary: string
  /** Full usage line, e.g. 'workflow edges <workflowId>'. */
  usage: string
  execute(rest: string[], runtime: AgentCliRuntime): Promise<AgentCliResult>
}

export function agentCliOk(stdout: string): AgentCliResult {
  return { exitCode: 0, stdout, stderr: '' }
}

export function agentCliFail(message: string): AgentCliResult {
  return { exitCode: 1, stdout: '', stderr: `Error: ${message}` }
}
