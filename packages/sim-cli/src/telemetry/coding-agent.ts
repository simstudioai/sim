/**
 * Detects the AI coding agent whose shell this process runs in.
 *
 * Agents mark the shells they spawn with an environment variable, and the CLI
 * reports that mark so usage driven by an agent can be told apart from a person
 * at a terminal. The checks, their order, and the names follow the GitHub CLI's
 * `internal/agents/detect.go` exactly: the generic `AI_AGENT` declaration
 * first, then vendor markers, with a more specific agent ahead of a broader
 * marker it also sets (Amp and Cowork both set `CLAUDECODE`).
 *
 * Four of that table's signals are deliberately left out, each one the GitHub
 * CLI itself marks as low confidence: `REPL_ID` (present in every Replit
 * environment), `GOOSE_PROVIDER` (Goose is merely configured),
 * `TERM_PROGRAM=kiro` (Kiro's terminal, which a person uses too), and a
 * `.pi/agent` entry on `PATH`. Each describes where a person is working rather
 * than an agent driving the command, so reporting it would attribute that
 * person's own commands to an agent.
 */

/** The value an agent may declare itself with under `AI_AGENT`. */
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

/** Vendor markers, in the GitHub CLI's order. */
const AGENT_MARKERS: readonly AgentMarker[] = [
  { name: 'amp', matches: (env) => env.AGENT === 'amp' },
  /** Set by Codex on the commands it runs (`codex-rs/core`: `spawn.rs`, `exec_env.rs`, `unified_exec`). */
  { name: 'codex', matches: anyOf('CODEX_SANDBOX', 'CODEX_CI', 'CODEX_THREAD_ID') },
  { name: 'gemini-cli', matches: anyOf('GEMINI_CLI') },
  { name: 'copilot-cli', matches: anyOf('COPILOT_CLI') },
  /** Not `OPENCODE_CALLER` or `OPENCODE_CLIENT`, which name what launched OpenCode. */
  { name: 'opencode', matches: anyOf('OPENCODE') },
  { name: 'antigravity', matches: anyOf('ANTIGRAVITY_AGENT') },
  { name: 'augment-cli', matches: anyOf('AUGMENT_AGENT') },
  { name: 'cowork', matches: anyOf('CLAUDE_CODE_IS_COWORK') },
  /** `CLAUDECODE` is documented in Claude Code's environment variable reference. */
  { name: 'claude-code', matches: anyOf('CLAUDECODE', 'CLAUDE_CODE') },
  { name: 'cursor', matches: anyOf('CURSOR_TRACE_ID') },
  {
    name: 'cursor-cli',
    matches: (env) => Boolean(env.CURSOR_AGENT) || env.CURSOR_EXTENSION_HOST_ROLE === 'agent-exec',
  },
]

/**
 * The shape Claude Code declares itself in: the name, its version with dots
 * replaced by dashes, and a role, joined by underscores — the form the Stripe
 * CLI's parser also expects. Only this shape is trimmed to its name; an
 * underscore anywhere else is part of the name.
 */
const VERSIONED_DECLARATION = /^(.+?)_\d+(?:-\d+)*(?:_[a-z0-9-]+)?$/

/**
 * A name an agent declared for itself, when it is a well-formed token.
 *
 * A declaration that carries a version and role (`claude-code_2-1-268_agent`)
 * is reduced to its name, so a breakdown by agent does not split into one
 * slice per release. Any other declaration is kept whole, underscores included.
 */
function declaredAgentName(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed.length > MAX_AGENT_NAME_LENGTH) return undefined
  if (!AGENT_NAME_PATTERN.test(trimmed)) return undefined
  return VERSIONED_DECLARATION.exec(trimmed)?.[1] ?? trimmed
}

/**
 * What the CLI reports when no agent is detected: a person at a terminal, or a
 * script. Sent explicitly so that an absent value means only that the client
 * did not report one — an older release, or reporting turned off.
 */
export const NO_CODING_AGENT = 'none'

/**
 * The agent driving this shell, or `undefined` for a person at a terminal.
 *
 * `AI_AGENT` is the generic convention agents use to name themselves, and wins
 * over every vendor marker when it holds a well-formed name.
 */
export function detectCodingAgent(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    declaredAgentName(env.AI_AGENT) ?? AGENT_MARKERS.find((marker) => marker.matches(env))?.name
  )
}
