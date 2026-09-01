/**
 * Replays change detection over real workflow states and reports, per workflow,
 * exactly which fields it would prompt a redeploy for.
 *
 * This is the ship gate for the canonical-form change: the invariant is that the
 * new pipeline must never report a field the old one did not. Erase-to-absent
 * only ever removes a distinction, so that should hold by construction — but ten
 * previous instances of this bug class were also "obviously" fine, so it gets
 * asserted against production data rather than reasoned about.
 *
 * Usage:
 *
 *   # 1. Record the current (new) behavior.
 *   bun run apps/sim/scripts/replay-change-detection.ts dump.jsonl > after.jsonl
 *
 *   # 2. Record the old behavior from before the change.
 *   git stash && bun run apps/sim/scripts/replay-change-detection.ts dump.jsonl > before.jsonl && git stash pop
 *
 *   # 3. Compare. Exits non-zero if any workflow gained a reported field.
 *   bun run apps/sim/scripts/replay-change-detection.ts --compare before.jsonl after.jsonl
 *
 * The dump is JSONL, one workflow per line:
 *
 *   {"workflowId": "...", "current": <WorkflowState>, "deployed": <WorkflowState>}
 *
 * `current` must come from `loadWorkflowDeploymentSnapshot` and `deployed` from
 * `materializeDeploymentState` — the same projections production compares. A
 * dump built from raw jsonb would be measuring a comparison nothing performs.
 */

import { readFileSync } from 'node:fs'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface DumpRow {
  workflowId: string
  current: WorkflowState
  deployed: WorkflowState | null
}

interface ReplayRow {
  workflowId: string
  hasChanges: boolean
  fields: string[]
}

/**
 * Field identity is `blockId.field` rather than just `field`, so a field that
 * stops being reported on one block but starts on another cannot cancel out.
 */
function reportedFields(current: WorkflowState, deployed: WorkflowState | null): string[] {
  const summary = generateWorkflowDiffSummary(current, deployed)
  const fields = new Set<string>()

  for (const block of summary.modifiedBlocks) {
    for (const change of block.changes) fields.add(`${block.id}.${change.field}`)
  }
  for (const block of summary.addedBlocks) fields.add(`+block.${block.id}`)
  for (const block of summary.removedBlocks) fields.add(`-block.${block.id}`)
  if (summary.edgeChanges.added > 0) fields.add('edges.added')
  if (summary.edgeChanges.removed > 0) fields.add('edges.removed')
  if (summary.loopChanges.modified > 0) fields.add('loops.modified')
  if (summary.parallelChanges.modified > 0) fields.add('parallels.modified')
  if (summary.variableChanges.modified > 0) fields.add('variables.modified')

  return [...fields].sort()
}

function replay(dumpPath: string): void {
  const lines = readFileSync(dumpPath, 'utf8').split('\n').filter(Boolean)

  for (const line of lines) {
    const row = JSON.parse(line) as DumpRow
    let out: ReplayRow

    try {
      const fields = reportedFields(row.current, row.deployed)
      out = { workflowId: row.workflowId, hasChanges: fields.length > 0, fields }
    } catch (error) {
      /*
       * A workflow that throws is a finding, not a skip: the comparison runs on
       * the deploy button's render path, so a throw is a broken panel.
       */
      out = {
        workflowId: row.workflowId,
        hasChanges: false,
        fields: [`__error__:${(error as Error).message}`],
      }
    }

    process.stdout.write(`${JSON.stringify(out)}\n`)
  }
}

function readReplay(path: string): Map<string, ReplayRow> {
  const rows = new Map<string, ReplayRow>()
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as ReplayRow
    rows.set(row.workflowId, row)
  }
  return rows
}

function compare(beforePath: string, afterPath: string): number {
  const before = readReplay(beforePath)
  const after = readReplay(afterPath)

  const gained: Array<{ workflowId: string; fields: string[] }> = []
  const lostByField = new Map<string, number>()
  let flippedToClean = 0
  let flippedToChanged = 0

  for (const [workflowId, afterRow] of after) {
    const beforeRow = before.get(workflowId)
    if (!beforeRow) continue

    const beforeFields = new Set(beforeRow.fields)
    const afterFields = new Set(afterRow.fields)

    const newlyReported = [...afterFields].filter((f) => !beforeFields.has(f))
    if (newlyReported.length > 0) gained.push({ workflowId, fields: newlyReported })

    for (const field of beforeFields) {
      if (afterFields.has(field)) continue
      /* Bucket by field NAME, not by block, so the report is readable. */
      const name = field.slice(field.indexOf('.') + 1)
      lostByField.set(name, (lostByField.get(name) ?? 0) + 1)
    }

    if (beforeRow.hasChanges && !afterRow.hasChanges) flippedToClean++
    if (!beforeRow.hasChanges && afterRow.hasChanges) flippedToChanged++
  }

  const log = (message: string) => process.stderr.write(`${message}\n`)

  log(`workflows compared: ${after.size}`)
  log(`flipped "Update" -> "Live": ${flippedToClean}`)
  log(`flipped "Live" -> "Update": ${flippedToChanged}`)
  log('')
  log('fields that stopped being reported (bucketed, review every bucket):')
  for (const [field, count] of [...lostByField].sort((a, b) => b[1] - a[1])) {
    log(`  ${String(count).padStart(6)}  ${field}`)
  }

  if (gained.length > 0) {
    log('')
    log(`BLOCKING: ${gained.length} workflow(s) gained a reported field.`)
    for (const entry of gained.slice(0, 20)) {
      log(`  ${entry.workflowId}: ${entry.fields.join(', ')}`)
    }
    if (gained.length > 20) log(`  ...and ${gained.length - 20} more`)
    return 1
  }

  if (flippedToChanged > 0) {
    log('')
    log(`BLOCKING: ${flippedToChanged} workflow(s) newly report changes.`)
    return 1
  }

  log('')
  log('OK: no workflow reports a field it did not report before.')
  return 0
}

const args = process.argv.slice(2)

if (args[0] === '--compare') {
  if (!args[1] || !args[2]) {
    process.stderr.write('usage: --compare <before.jsonl> <after.jsonl>\n')
    process.exit(2)
  }
  process.exit(compare(args[1], args[2]))
}

if (!args[0]) {
  process.stderr.write('usage: replay-change-detection.ts <dump.jsonl>\n')
  process.exit(2)
}

replay(args[0])
