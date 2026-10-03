/**
 * Produces the JSONL the replay harness consumes, using the SAME loaders
 * production compares.
 *
 * This exists because SQL cannot produce the right operands. The draft side is
 * assembled by `loadWorkflowFromNormalizedTables`, which applies the block
 * migrations, materializes loop/parallel defaults and canonicalizes edge
 * handles; the deployed side is a frozen blob that `materializeDeploymentState`
 * re-migrates, re-canonicalizes and backfills `errorEnabled` on. Rebuilding
 * either of those in SQL would be a second spelling of the loaders — the exact
 * mistake the change this validates exists to remove.
 *
 * Usage (from apps/sim, with DATABASE_URL pointing at a read replica). Note that
 * `DATABASE_URL` must not carry libpq-only SSL params: postgres.js forwards any
 * query param it does not recognize as a session parameter, so `sslrootcert`
 * fails every query with `42704`. `?sslmode=verify-full` alone keeps full
 * verification.
 *
 *   bun run scripts/dump-change-detection-states.ts --out dump.jsonl --limit 500
 *   bun run scripts/dump-change-detection-states.ts --out dump.jsonl --webhooks-only \
 *     --simulate-focus                 # reproduce the panel-focus read-back
 *   bun run scripts/dump-change-detection-states.ts --out dump.jsonl --raw
 *                                      # keep credential values verbatim
 *
 * Values under credential-shaped keys are replaced with a deterministic hash by
 * default, so equality is preserved on both sides while the plaintext is not
 * written to disk. Scoped to those keys rather than all strings on purpose:
 * hashing a value that happens to equal its declared `defaultValue` would break
 * the exact comparison being validated, and credential fields never declare one.
 */

import { createHash } from 'node:crypto'
import { closeSync, openSync, writeSync } from 'node:fs'
import { db, workflowDeploymentVersion } from '@sim/db'
import { webhook as webhookTable, workflow as workflowTable } from '@sim/db/schema'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  loadWorkflowDeploymentSnapshot,
  materializeDeploymentState,
} from '@/lib/workflows/persistence/utils'
import type { BlockState, SubBlockState } from '@/stores/workflows/workflow/types'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'
import { resolveBlockTriggerId } from '@/triggers/webhook-url'

const SECRET_KEY_PATTERN = /(token|secret|password|apikey|api_key|credential)/i

function hashValue(value: string): string {
  return `scrubbed:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

function scrubBlocks(blocks: Record<string, BlockState>): Record<string, BlockState> {
  const out: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const subBlocks: Record<string, SubBlockState> = {}
    for (const [subId, subBlock] of Object.entries(block.subBlocks ?? {})) {
      const value = subBlock.value
      subBlocks[subId] =
        SECRET_KEY_PATTERN.test(subId) && typeof value === 'string' && value.length > 0
          ? { ...subBlock, value: hashValue(value) }
          : subBlock
    }
    out[blockId] = { ...block, subBlocks }
  }

  return out
}

/**
 * Reproduces what opening a trigger block's editor panel does to live state:
 * `useWebhookManagement` reads the deployed `webhook.providerConfig` — into which
 * deploy materialized every declared default — and writes it back over any field
 * the block holds blank.
 *
 * The replay cannot observe this without simulating it. Those writes go through
 * a non-persisting `setValue`, so they exist only in the browser's store and are
 * absent from every database-sourced snapshot. A dump taken straight from the
 * draft therefore shows the workflow as clean no matter how badly the panel
 * misreports it.
 */
function simulateFocus(
  blocks: Record<string, BlockState>,
  providerConfigByBlockId: Map<string, Record<string, unknown>>
): Record<string, BlockState> {
  const out: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const providerConfig = providerConfigByBlockId.get(blockId)
    const triggerId = providerConfig ? resolveBlockTriggerId(block) : undefined

    if (!providerConfig || !triggerId || !isTriggerValid(triggerId)) {
      out[blockId] = block
      continue
    }

    const subBlocks: Record<string, SubBlockState> = { ...(block.subBlocks ?? {}) }
    for (const subBlock of getTrigger(triggerId).subBlocks) {
      if (subBlock.mode !== 'trigger' && subBlock.mode !== 'trigger-advanced') continue
      if (SYSTEM_SUBBLOCK_IDS.includes(subBlock.id)) continue

      const configValue = providerConfig[subBlock.id]
      if (configValue === undefined || configValue === null) continue

      const current = subBlocks[subBlock.id]?.value
      if (current !== null && current !== undefined && current !== '') continue

      subBlocks[subBlock.id] = {
        id: subBlock.id,
        type: subBlocks[subBlock.id]?.type ?? 'short-input',
        value: configValue as SubBlockState['value'],
      }
    }

    out[blockId] = { ...block, subBlocks }
  }

  return out
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const limitArg = args.indexOf('--limit')
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 200
  const raw = args.includes('--raw')
  const focus = args.includes('--simulate-focus')
  const webhooksOnly = args.includes('--webhooks-only')

  /*
   * Written to a file, not stdout. `loadWorkflowFromNormalizedTables` logs — it
   * warns whenever its fire-and-forget migration write-back fails, which it
   * always does against a read replica — and those lines land on stdout and
   * corrupt the JSONL.
   */
  const outArg = args.indexOf('--out')
  if (outArg < 0) {
    process.stderr.write(
      'usage: --out <dump.jsonl> [--limit N] [--webhooks-only] [--simulate-focus] [--raw]\n'
    )
    process.exit(2)
  }
  const outFd = openSync(args[outArg + 1], 'w')

  const rows = await db
    .select({
      workflowId: workflowTable.id,
      workspaceId: workflowTable.workspaceId,
      versionId: workflowDeploymentVersion.id,
      state: workflowDeploymentVersion.state,
    })
    .from(workflowDeploymentVersion)
    .innerJoin(workflowTable, eq(workflowTable.id, workflowDeploymentVersion.workflowId))
    .where(and(eq(workflowDeploymentVersion.isActive, true), isNull(workflowTable.archivedAt)))
    .orderBy(desc(workflowDeploymentVersion.createdAt))
    .limit(limit)

  const webhookRows = rows.length
    ? await db
        .select({
          workflowId: webhookTable.workflowId,
          blockId: webhookTable.blockId,
          providerConfig: webhookTable.providerConfig,
        })
        .from(webhookTable)
        .where(
          inArray(
            webhookTable.workflowId,
            rows.map((r) => r.workflowId)
          )
        )
    : []

  const webhooksByWorkflow = new Map<string, Map<string, Record<string, unknown>>>()
  for (const wh of webhookRows) {
    if (!wh.blockId || !wh.providerConfig) continue
    const perBlock = webhooksByWorkflow.get(wh.workflowId) ?? new Map()
    perBlock.set(wh.blockId, wh.providerConfig as Record<string, unknown>)
    webhooksByWorkflow.set(wh.workflowId, perBlock)
  }

  let emitted = 0
  let failed = 0

  for (const row of rows) {
    try {
      const webhooks = webhooksByWorkflow.get(row.workflowId)
      if (webhooksOnly && !webhooks) continue

      if (!row.workspaceId) continue
      const current = await loadWorkflowDeploymentSnapshot(row.workflowId)
      if (!current) continue

      const deployed = await materializeDeploymentState(
        row.workflowId,
        { id: row.versionId, state: row.state },
        row.workspaceId
      )

      const currentBlocks =
        focus && webhooks ? simulateFocus(current.blocks, webhooks) : current.blocks

      writeSync(
        outFd,
        `${JSON.stringify({
          workflowId: row.workflowId,
          current: raw
            ? { ...current, blocks: currentBlocks }
            : { ...current, blocks: scrubBlocks(currentBlocks) },
          deployed: raw ? deployed : { ...deployed, blocks: scrubBlocks(deployed.blocks) },
        })}\n`
      )
      emitted++
    } catch (error) {
      /* Reported, never silently skipped: a workflow that cannot load is a finding. */
      failed++
      process.stderr.write(`skip ${row.workflowId}: ${(error as Error).message}\n`)
    }
  }

  closeSync(outFd)
  process.stderr.write(`emitted ${emitted} workflow(s), ${failed} failed\n`)
  process.exit(0)
}

void main()
