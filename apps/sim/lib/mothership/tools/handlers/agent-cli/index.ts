import { getErrorMessage } from '@sim/utils/errors'
import { workflowDepsCommand } from '@/lib/mothership/tools/handlers/agent-cli/commands/deps'
import { filesGrepCommand } from '@/lib/mothership/tools/handlers/agent-cli/commands/files-grep'
import {
  workflowGrepCommand,
  workflowsGrepCommand,
} from '@/lib/mothership/tools/handlers/agent-cli/commands/grep'
import { workflowLintCommand } from '@/lib/mothership/tools/handlers/agent-cli/commands/lint'
import { logsQueryCommand } from '@/lib/mothership/tools/handlers/agent-cli/commands/query'
import { workflowTraceCommand } from '@/lib/mothership/tools/handlers/agent-cli/commands/trace'
import {
  workflowBlocksCommand,
  workflowEdgesCommand,
} from '@/lib/mothership/tools/handlers/agent-cli/commands/workflow-views'
import {
  type AgentCliCommand,
  type AgentCliResult,
  type AgentCliRuntime,
  agentCliFail,
} from '@/lib/mothership/tools/handlers/agent-cli/types'

/**
 * The registry of agent-only augmentations, longest prefix wins. Adding a
 * capability = one command object here; it appears in the merged --help
 * automatically.
 */
const AGENT_CLI_COMMANDS: readonly AgentCliCommand[] = [
  filesGrepCommand,
  logsQueryCommand,
  workflowDepsCommand,
  workflowBlocksCommand,
  workflowEdgesCommand,
  workflowGrepCommand,
  workflowLintCommand,
  workflowTraceCommand,
  workflowsGrepCommand,
]

/** Global flags (with values) that may precede the subcommand, e.g. --output json. */
const VALUE_FLAGS = new Set(['--output', '-o'])

/**
 * Splits an invocation into bare command tokens and command-local flags.
 * `--flag value` and `--flag=value` become string entries, a trailing or
 * value-less `--flag` becomes `true`; global rendering flags are dropped.
 */
function parseInvocation(args: string[]): { tokens: string[]; flags: Map<string, string | true> } {
  const tokens: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('-')) {
      tokens.push(arg)
      continue
    }
    if (VALUE_FLAGS.has(arg)) {
      i++
      continue
    }
    const name = arg.replace(/^-+/, '')
    const equalsIndex = name.indexOf('=')
    if (equalsIndex > 0) {
      flags.set(name.slice(0, equalsIndex), name.slice(equalsIndex + 1))
      continue
    }
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('-')) {
      flags.set(name, next)
      i++
    } else {
      flags.set(name, true)
    }
  }
  return { tokens, flags }
}

export interface AgentCliMatch {
  command: AgentCliCommand
  rest: string[]
  flags: Map<string, string | true>
}

export function matchAgentCliCommand(args: string[]): AgentCliMatch | null {
  const { tokens, flags } = parseInvocation(args)
  let best: AgentCliMatch | null = null
  for (const command of AGENT_CLI_COMMANDS) {
    const matches =
      tokens.length >= command.path.length &&
      command.path.every((part, index) => tokens[index] === part)
    if (matches && (!best || command.path.length > best.command.path.length)) {
      best = { command, rest: tokens.slice(command.path.length), flags }
    }
  }
  return best
}

export async function executeAgentCliCommand(
  match: AgentCliMatch,
  runtime: AgentCliRuntime
): Promise<AgentCliResult> {
  try {
    return await match.command.execute(match.rest, runtime, match.flags)
  } catch (error) {
    return agentCliFail(getErrorMessage(error))
  }
}

/** True for a bare help invocation whose output should include the agent section. */
export function isRootHelpInvocation(args: string[]): boolean {
  const meaningful = args.filter((a) => a !== '--output' && a !== 'json' && a !== '-o')
  return (
    meaningful.length === 0 ||
    (meaningful.length === 1 && (meaningful[0] === 'help' || meaningful[0] === '--help'))
  )
}

/** The section appended to the real CLI's root help. */
export function agentCliHelpSection(): string {
  const lines = AGENT_CLI_COMMANDS.map(
    (command) => `  ${command.usage.padEnd(38)} ${command.summary}`
  )
  return `\nAgent commands (available in this environment only):\n${lines.join('\n')}\n\nAny command's stdout can be filtered with a trailing pipe into grep (the only pipe target):\n  sim workflows export <id> | grep -in slack\n`
}
