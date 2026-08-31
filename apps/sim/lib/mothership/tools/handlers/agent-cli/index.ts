import {
  workflowGrepCommand,
  workflowsGrepCommand,
} from '@/lib/mothership/tools/handlers/agent-cli/commands/grep'
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
  workflowBlocksCommand,
  workflowEdgesCommand,
  workflowGrepCommand,
  workflowsGrepCommand,
]

/** Global flags (with values) that may precede the subcommand, e.g. --output json. */
const VALUE_FLAGS = new Set(['--output', '-o'])

/** Strips global flags (and their values) so matching sees bare command tokens. */
function commandTokens(args: string[]): string[] {
  const tokens: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('-')) {
      if (VALUE_FLAGS.has(arg)) i++
      continue
    }
    tokens.push(arg)
  }
  return tokens
}

export function matchAgentCliCommand(
  args: string[]
): { command: AgentCliCommand; rest: string[] } | null {
  const tokens = commandTokens(args)
  let best: { command: AgentCliCommand; rest: string[] } | null = null
  for (const command of AGENT_CLI_COMMANDS) {
    const matches =
      tokens.length >= command.path.length &&
      command.path.every((part, index) => tokens[index] === part)
    if (matches && (!best || command.path.length > best.command.path.length)) {
      best = { command, rest: tokens.slice(command.path.length) }
    }
  }
  return best
}

export async function executeAgentCliCommand(
  match: { command: AgentCliCommand; rest: string[] },
  runtime: AgentCliRuntime
): Promise<AgentCliResult> {
  try {
    return await match.command.execute(match.rest, runtime)
  } catch (error) {
    return agentCliFail(error instanceof Error ? error.message : String(error))
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
  return `\nAgent commands (available in this environment only):\n${lines.join('\n')}\n`
}
