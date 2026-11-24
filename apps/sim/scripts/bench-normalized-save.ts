#!/usr/bin/env bun
/**
 * Benchmarks `saveWorkflowToNormalizedTables`, the write every draft replace (source apply,
 * operations apply, Copilot edits) runs inside the workflow row lock. For each graph size it
 * times a one-field edit, a shrink to 10 blocks and a grow back, against a disposable test
 * database. Measurement only: nothing asserts on timings.
 *
 * Usage (from apps/sim):
 *   DATABASE_URL=postgresql://127.0.0.1:5432/sim_bench_test \
 *   BENCH_REPORT_PATH=/tmp/save-bench.json bun scripts/bench-normalized-save.ts [--background-edges 160000]
 *
 * `--background-edges` seeds other workflows' edges first, so foreign-key cascade lookups that
 * lack an index pay a realistic table scan. Fixtures are removed at the end.
 */
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { db, user, workflow, workflowBlocks, workflowEdges } from '@sim/db'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq, sql } from 'drizzle-orm'

const logger = createLogger('BenchNormalizedSave')

const SIZES = [5, 50, 300, 700]
const REPEATS = 5
const SHRUNK_SIZE = 10

interface BenchRow {
  blocks: number
  oneFieldEditMs: number
  shrinkMs: number
  growMs: number
}

function graph(size: number): WorkflowState {
  const blocks: BlockState[] = []
  let loopId: string | undefined
  for (let index = 0; index < size; index++) {
    const id = generateId()
    if (index % 7 === 0) {
      loopId = id
      blocks.push({
        id,
        type: 'loop',
        name: `Loop ${index}`,
        position: { x: index * 50, y: 400 },
        enabled: true,
        outputs: {},
        subBlocks: {},
        data: { loopType: 'for', count: 3 },
      })
      continue
    }
    blocks.push({
      id,
      type: index % 2 ? 'function' : 'agent',
      name: `Block ${index}`,
      position: { x: index * 50, y: 0 },
      enabled: true,
      outputs: { result: { type: 'json' } },
      subBlocks: {
        code: { id: 'code', type: 'code', value: `return ${index}` },
        prompt: { id: 'prompt', type: 'long-input', value: `Step ${index} of the bench graph` },
      },
      data: index % 7 === 1 && loopId ? { parentId: loopId, extent: 'parent' } : {},
    })
  }
  const edges = blocks
    .slice(1)
    .filter((block) => block.type !== 'loop')
    .map((block, index) => ({ id: generateId(), source: blocks[index].id, target: block.id }))
  return {
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
    edges,
    loops: {},
    parallels: {},
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function timedSave(workflowId: string, state: WorkflowState): Promise<number> {
  const started = performance.now()
  const result = await saveWorkflowToNormalizedTables(workflowId, state)
  if (!result.success) throw new Error(result.error)
  return performance.now() - started
}

function withEdit(state: WorkflowState, round: number): WorkflowState {
  const edited = structuredClone(state)
  const target = Object.values(edited.blocks).find((block) => block.type === 'function')
  if (target) target.subBlocks.code = { id: 'code', type: 'code', value: `return ${round}` }
  return edited
}

function shrunk(state: WorkflowState): WorkflowState {
  const kept = Object.values(state.blocks)
    .filter((block) => !block.data?.parentId && block.type !== 'loop')
    .slice(0, SHRUNK_SIZE)
  const ids = new Set(kept.map((block) => block.id))
  return {
    ...state,
    blocks: Object.fromEntries(kept.map((block) => [block.id, block])),
    edges: state.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  }
}

async function seedBackgroundEdges(ownerId: string, count: number): Promise<void> {
  const perWorkflow = 400
  for (let seeded = 0; seeded < count; seeded += perWorkflow) {
    const workflowId = await insertWorkflow(ownerId, 'Bench background')
    await db.execute(sql`
      INSERT INTO ${workflowBlocks} (id, workflow_id, type, name, position_x, position_y)
      SELECT ${workflowId} || '_b' || g, ${workflowId}, 'function', 'f', 0, 0
      FROM generate_series(0, ${perWorkflow}) g`)
    await db.execute(sql`
      INSERT INTO ${workflowEdges} (id, workflow_id, source_block_id, target_block_id)
      SELECT ${workflowId} || '_e' || g, ${workflowId}, ${workflowId} || '_b' || g,
        ${workflowId} || '_b' || (g + 1)
      FROM generate_series(0, ${perWorkflow - 1}) g`)
  }
  await db.execute(sql`ANALYZE workflow_blocks, workflow_edges`)
}

async function insertWorkflow(ownerId: string, name: string): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db
    .insert(workflow)
    .values({ id, userId: ownerId, name, lastSynced: now, createdAt: now, updatedAt: now })
  return id
}

async function main() {
  const { values } = parseArgs({
    options: { 'background-edges': { type: 'string', default: '0' } },
  })
  assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')
  const reportPath = process.env.BENCH_REPORT_PATH
  const ownerId = generateId()
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Save bench',
    email: `${ownerId}@save-bench.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })

  const rows: BenchRow[] = []
  try {
    await seedBackgroundEdges(ownerId, Number(values['background-edges']))
    for (const size of SIZES) {
      const workflowId = await insertWorkflow(ownerId, `Bench ${size}`)
      const full = graph(size)
      await timedSave(workflowId, full)
      const edits: number[] = []
      for (let round = 0; round < REPEATS; round++) {
        edits.push(await timedSave(workflowId, withEdit(full, round)))
      }
      const shrinkMs = await timedSave(workflowId, shrunk(full))
      const growMs = await timedSave(workflowId, full)
      rows.push({ blocks: size, oneFieldEditMs: median(edits), shrinkMs, growMs })
    }
  } finally {
    await db.delete(user).where(eq(user.id, ownerId))
  }

  const report = { backgroundEdges: Number(values['background-edges']), repeats: REPEATS, rows }
  logger.info('Normalized save benchmark', report)
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}

main().catch((error) => {
  logger.error('Normalized save benchmark failed', { error })
  process.exit(1)
})
