/**
 * Prints the source primers as JSON: `workflow` and `workspace`, the ones `sim workflows source
 * get` and `sim workspaces source get` write atop `.sim/AGENTS.md` for a coding agent, and
 * `chat.workflow`, the one a get writes inside Mothership, which the mothership worker takes
 * verbatim as its `workflow-source` skill. Mothership has no workspace source, so `chat` holds
 * the workflow primer alone.
 *
 *   bun run packages/sim-cli/scripts/print-source-primers.ts > primers.json
 */
import { type PrimerKind, sourcePrimer } from '#sim-cli/commands/protocol/source-primer'

const KINDS: readonly PrimerKind[] = ['workflow', 'workspace']

const primers = {
  ...Object.fromEntries(KINDS.map((kind) => [kind, sourcePrimer(kind, 'cli')])),
  chat: { workflow: sourcePrimer('workflow', 'chat') },
}

process.stdout.write(`${JSON.stringify(primers, null, 2)}\n`)
