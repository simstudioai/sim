/**
 * Prints the workflow and workspace source primers as JSON, for the mothership worker's
 * `workflow-source` skill. The text is the one `sim workflows source get` and `sim workspaces
 * source get` write atop `.sim/AGENTS.md`, so the agent's preloaded guide never differs from the
 * one the CLI gives a coding agent.
 *
 *   bun run packages/sim-cli/scripts/print-source-primers.ts > primers.json
 */
import { type PrimerKind, sourcePrimer } from '#sim-cli/commands/protocol/source-primer'

const KINDS: readonly PrimerKind[] = ['workflow', 'workspace']

const primers = Object.fromEntries(KINDS.map((kind) => [kind, sourcePrimer(kind)]))

process.stdout.write(`${JSON.stringify(primers, null, 2)}\n`)
