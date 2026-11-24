import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { sortObjectKeysDeep } from '@sim/utils/object'

/**
 * The build-notes document: the template `build-notes create` writes, and what evaluation reads
 * back from it (the operations block, placeholders, and open items still to settle).
 */

/**
 * The fenced block holding the batch `workflows operations apply` builds from: its operations
 * array, or the whole apply body when the batch also enables or disables blocks.
 */
/** Both fences on their own lines, so a backtick run inside a JSON string never closes it. */
const OPERATIONS_FENCE = /^```json[ \t]+operations[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm
/**
 * An unknown value left visible in the graph: `<<open:escalation_channel>>`. Only the operations
 * block is the graph, so a placeholder named anywhere else (guidance, the pass log) blocks nothing.
 */
const PLACEHOLDER = /<<open:([^>\n]{1,200})>>/g
/** Any list marker, an optionally bold mark, and text that may be empty: an unsettled item still blocks. */
const OPEN_ITEM =
  /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*|__)?\[(gather|ask|assume)\](?:\*\*|__)?:?\s*(.*)$/i

/** The largest notes file a write accepts. */
export const MAX_BUILD_NOTES_BYTES = 256 * 1024

/** The notes `create` writes: every section the loop fills in, with an empty operations block. */
export function buildNotesTemplate(workflowName: string): string {
  return `# Build notes: ${workflowName}

Agent-only working notes for this workflow. Sim keeps them with the workflow and never shows them in Files. Build from the operations block below once \`build-notes evaluate\` passes.

## Request
The user's requests and answers, verbatim.

## Goal and success criteria
What working means, in a form a test run can check.

## Trigger, inputs and runtime identity

## Graph
One line per block saying what it is for, then the whole batch to apply: an operations array, or {"operations": [...], "setBlockEnabled": [...]} when it also enables or disables blocks. Leave an unknown value in the batch as a visible placeholder, like <<open:escalation_channel>>.

\`\`\`json operations
[]
\`\`\`

## Values
Every consequential value (people, channels, projects, thresholds, recipients, timings, matching rules) with its origin: request, document (cite it), default, or guess.

## Open items
One per line, marked [gather] (a search can settle it), [ask] (only the user can decide it) or [assume] (reversible, or still unsettled after searching).

## Assumptions
Each with its value, the block field it sets, why it was chosen, what would change it, and its status: assumed, confirmed, or replaced by the user.

## Sources

## Pass log

## Build record

## Change log
`
}

/** What evaluation reads from the notes text. */
export interface BuildNotesReading {
  /** The apply body the block holds, or null when it is missing or not JSON. */
  batch: unknown
  operationsError: string | null
  /** Placeholders still open in the operations block. */
  placeholders: string[]
  /** Open items still marked [gather] or [ask]: they block a build. */
  blockingOpenItems: { mark: 'gather' | 'ask'; text: string }[]
  assumedItems: number
}

/**
 * Reads the operations block (exactly one), the placeholders inside it, and the items under
 * `## Open items`. Never throws: a missing or malformed block is reported in `operationsError`.
 */
export function readBuildNotes(notes: string): BuildNotesReading {
  const blocks = [...notes.matchAll(OPERATIONS_FENCE)]
  let batch: unknown = null
  let operationsError: string | null = null
  if (blocks.length === 0) operationsError = 'No ```json operations block in the notes'
  else if (blocks.length > 1)
    operationsError = 'More than one ```json operations block in the notes'
  else {
    try {
      const parsed: unknown = JSON.parse(blocks[0]?.[1] ?? '')
      batch = Array.isArray(parsed) ? { operations: parsed } : parsed
    } catch (error) {
      operationsError = `The operations block is not valid JSON: ${getErrorMessage(error, 'unreadable')}`
    }
  }
  const graph = blocks.length === 1 ? (blocks[0]?.[1] ?? '') : ''
  const placeholders = [...new Set([...graph.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))]
  const blockingOpenItems: BuildNotesReading['blockingOpenItems'] = []
  let assumedItems = 0
  for (const line of openItemsSection(notes)) {
    const match = OPEN_ITEM.exec(line)
    if (!match) continue
    const mark = (match[1] ?? '').toLowerCase()
    if (mark === 'assume') assumedItems++
    else if (mark === 'gather' || mark === 'ask')
      blockingOpenItems.push({ mark, text: (match[2] ?? '').trim() })
  }
  return { batch, operationsError, placeholders, blockingOpenItems, assumedItems }
}

/** The lines under `## Open items`, up to the next heading of the same or higher level. */
function openItemsSection(notes: string): string[] {
  const lines = notes.split('\n')
  const start = lines.findIndex((line) => /^##\s+open items\s*:?$/i.test(line.trim()))
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line))
  return end < 0 ? rest : rest.slice(0, end)
}

/** The identity of the notes text an evaluation passed. */
export function notesHash(notes: string): string {
  return sha256Hex(notes)
}

/** What a build writes, as evaluation and the apply check compare it. */
export interface BuildNotesBatch {
  operations: readonly unknown[]
  blockEnabledChanges?: readonly { blockId: string; enabled: boolean }[]
}

/** The identity of what an apply writes, independent of key order and whitespace. */
export function batchHash(batch: BuildNotesBatch): string {
  return sha256Hex(
    JSON.stringify(
      sortObjectKeysDeep({
        operations: batch.operations,
        blockEnabledChanges: batch.blockEnabledChanges ?? [],
      })
    )
  )
}
