/**
 * Detects the AI coding agent whose shell this process runs in.
 *
 * Agents mark the shells they spawn with an environment variable, and the CLI
 * reports that mark so usage driven by an agent can be told apart from a person
 * at a terminal. The checks, their order, and the names follow the GitHub CLI
 * (`internal/agents/detect.go`), which is the most complete verified table:
 * generic conventions first, then vendor markers, with the more specific
 * marker ahead of a broader one it implies (Amp sets `CLAUDECODE` too; Cowork
 * is Claude Code plus its own flag).
 *
 * Only markers an agent sets on the shells it drives are consulted. Variables
 * that merely mean an agent is installed or configured — `REPL_ID`,
 * `GOOSE_PROVIDER`, `AIDER_*`, `COPILOT_*` — are deliberately absent, because
 * they would attribute a person's own command to an agent.
 */

/** The value an agent may declare itself with under the generic conventions. */
const AGENT_NAME_PATTERN = /^[a-z0-9_-]+$/i
const MAX_AGENT_NAME_LENGTH = 64

interface AgentMarker {
  readonly name: string
  readonly matches: (env: NodeJS.ProcessEnv) => boolean
}

const anyOf =
  (...variables: readonly string[]) =>
  (env: NodeJS.ProcessEnv) =>
    variables.some((variable) => Boolean(env[variable]))

/** Vendor markers, most specific first. */
const AGENT_MARKERS: readonly AgentMarker[] = [
  { name: 'amp', matches: (env) => env.AGENT === 'amp' || Boolean(env.AMP_CURRENT_THREAD_ID) },
  {
    name: 'codex',
    matches: anyOf(
      'CODEX_THREAD_ID',
      'CODEX_SANDBOX',
      'CODEX_CI',
      'CODEX_SANDBOX_NETWORK_DISABLED'
    ),
  },
  { name: 'gemini-cli', matches: anyOf('GEMINI_CLI') },
  { name: 'opencode', matches: anyOf('OPENCODE') },
  { name: 'antigravity', matches: anyOf('ANTIGRAVITY_AGENT') },
  { name: 'augment', matches: anyOf('AUGMENT_AGENT') },
  { name: 'cline', matches: anyOf('CLINE_ACTIVE') },
  { name: 'cowork', matches: anyOf('CLAUDE_CODE_IS_COWORK') },
  { name: 'claude-code', matches: anyOf('CLAUDECODE', 'CLAUDE_CODE') },
  {
    name: 'cursor',
    matches: (env) =>
      anyOf('CURSOR_AGENT', 'CURSOR_TRACE_ID')(env) ||
      env.CURSOR_EXTENSION_HOST_ROLE === 'agent-exec',
  },
  { name: 'warp', matches: anyOf('OZ_RUN_ID') },
  { name: 'pi', matches: anyOf('PI_CODING_AGENT') },
  { name: 'crush', matches: anyOf('CRUSH') },
]

/** A name an agent declared for itself, when it is a well-formed token. */
function declaredAgentName(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed.length > MAX_AGENT_NAME_LENGTH) return undefined
  return AGENT_NAME_PATTERN.test(trimmed) ? trimmed : undefined
}

/**
 * The agent driving this shell, or `undefined` for a person at a terminal.
 *
 * `AI_AGENT` and `AGENT` are the two generic conventions agents have converged
 * on for naming themselves and win over vendor markers when set. `AGENT` is
 * consulted only when it carries a name: OpenCode sets it to `1`, which names
 * nothing, and its own marker handles it.
 */
export function detectCodingAgent(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const declared = declaredAgentName(env.AI_AGENT)
  if (declared) return declared

  const generic = declaredAgentName(env.AGENT)
  if (generic && generic !== '1') return generic

  return AGENT_MARKERS.find((marker) => marker.matches(env))?.name
}
