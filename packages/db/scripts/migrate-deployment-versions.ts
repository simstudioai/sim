#!/usr/bin/env bun

// This script is intentionally self-contained for execution in the migrations image.
// Do not import from the main app code; duplicate minimal schema and DB setup here.

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { v4 as uuidv4 } from 'uuid'

// ---------- Minimal env helpers ----------
function getEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && name in process.env) {
    return process.env[name]
  }
  return undefined
}

const CONNECTION_STRING = getEnv('POSTGRES_URL') ?? getEnv('DATABASE_URL')
if (!CONNECTION_STRING) {
  console.error('Missing POSTGRES_URL or DATABASE_URL environment variable')
  process.exit(1)
}

// ---------- Minimal schema (only what we need) ----------
import { boolean, index, integer, json, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Tables referenced by the script
const workflow = pgTable(
  'workflow',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    isDeployed: boolean('is_deployed').notNull().default(false),
    deployedState: json('deployed_state'),
    deployedAt: timestamp('deployed_at'),
  },
  (table) => ({
    userIdIdx: index('workflow_user_id_idx').on(table.userId),
  })
)

const workflowBlocks = pgTable(
  'workflow_blocks',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    positionX: text('position_x').notNull(),
    positionY: text('position_y').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    horizontalHandles: boolean('horizontal_handles').notNull().default(true),
    isWide: boolean('is_wide').notNull().default(false),
    advancedMode: boolean('advanced_mode').notNull().default(false),
    triggerMode: boolean('trigger_mode').notNull().default(false),
    height: text('height').notNull().default('0'),
    subBlocks: jsonb('sub_blocks').notNull().default('{}'),
    outputs: jsonb('outputs').notNull().default('{}'),
    data: jsonb('data').default('{}'),
    parentId: text('parent_id'),
    extent: text('extent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_blocks_workflow_id_idx').on(table.workflowId),
  })
)

const workflowEdges = pgTable(
  'workflow_edges',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    sourceBlockId: text('source_block_id').notNull(),
    targetBlockId: text('target_block_id').notNull(),
    sourceHandle: text('source_handle'),
    targetHandle: text('target_handle'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_edges_workflow_id_idx').on(table.workflowId),
  })
)

const workflowSubflows = pgTable(
  'workflow_subflows',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    type: text('type').notNull(),
    config: jsonb('config').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_subflows_workflow_id_idx').on(table.workflowId),
  })
)

const workflowDeploymentVersion = pgTable(
  'workflow_deployment_version',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    version: integer('version').notNull(),
    state: json('state').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => ({
    workflowIdIdx: index('workflow_deployment_version_workflow_id_idx').on(table.workflowId),
  })
)

// ---------- DB client ----------
const postgresClient = postgres(CONNECTION_STRING, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 10,
  onnotice: () => {},
})
const db = drizzle(postgresClient)

// ---------- Minimal types ----------
type WorkflowState = {
  blocks: Record<string, any>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
  loops: Record<string, any>
  parallels: Record<string, any>
}

// ---------- Normalized loader (inline of loadWorkflowFromNormalizedTables) ----------
async function loadWorkflowFromNormalizedTables(workflowId: string) {
  const [blocks, edges, subflows] = await Promise.all([
    db.select().from(workflowBlocks).where(sql`${workflowBlocks.workflowId} = ${workflowId}`),
    db.select().from(workflowEdges).where(sql`${workflowEdges.workflowId} = ${workflowId}`),
    db.select().from(workflowSubflows).where(sql`${workflowSubflows.workflowId} = ${workflowId}`),
  ])

  if (blocks.length === 0) return null

  const blocksMap: Record<string, any> = {}
  for (const block of blocks as any[]) {
    const parentId = (block.parentId as string | null) || null
    const extent = (block.extent as string | null) || null

    blocksMap[block.id] = {
      id: block.id,
      type: block.type,
      name: block.name,
      position: {
        x: Number(block.positionX),
        y: Number(block.positionY),
      },
      enabled: block.enabled,
      horizontalHandles: block.horizontalHandles,
      isWide: block.isWide,
      advancedMode: block.advancedMode,
      triggerMode: block.triggerMode,
      height: Number(block.height),
      subBlocks: block.subBlocks || {},
      outputs: block.outputs || {},
      data: {
        ...(block.data || {}),
        ...(parentId && { parentId }),
        ...(extent && { extent }),
      },
      parentId,
      extent,
    }
  }

  const edgesArray = (edges as any[]).map((edge) => ({
    id: edge.id,
    source: edge.sourceBlockId,
    target: edge.targetBlockId,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }))

  const loops: Record<string, any> = {}
  const parallels: Record<string, any> = {}
  for (const sub of subflows as any[]) {
    const config = sub.config || {}
    if (sub.type === 'loop') {
      loops[sub.id] = { id: sub.id, ...config }
    } else if (sub.type === 'parallel') {
      parallels[sub.id] = { id: sub.id, ...config }
    }
  }

  return {
    blocks: blocksMap,
    edges: edgesArray,
    loops,
    parallels,
    isFromNormalizedTables: true,
  }
}

// ---------- Migration ----------
const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_SIZE = 50

async function migrateWorkflows() {
  console.log('Starting deployment version migration...')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Batch size: ${BATCH_SIZE}`)
  console.log('---')

  try {
    const workflows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        isDeployed: workflow.isDeployed,
        deployedState: workflow.deployedState,
        deployedAt: workflow.deployedAt,
        userId: workflow.userId,
      })
      .from(workflow)

    console.log(`Found ${workflows.length} workflows to process`)

    const existingVersions = await db
      .select({ workflowId: workflowDeploymentVersion.workflowId })
      .from(workflowDeploymentVersion)

    const existingWorkflowIds = new Set(existingVersions.map((v) => v.workflowId as string))
    console.log(`${existingWorkflowIds.size} workflows already have deployment versions`)

    let successCount = 0
    let skipCount = 0
    let errorCount = 0

    for (let i = 0; i < workflows.length; i += BATCH_SIZE) {
      const batch = workflows.slice(i, i + BATCH_SIZE)
      console.log(
        `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} (workflows ${i + 1}-${Math.min(i + BATCH_SIZE, workflows.length)})`
      )

      const deploymentVersions: Array<{
        id: string
        workflowId: string
        version: number
        state: WorkflowState
        createdAt: Date
        createdBy: string
        isActive: boolean
      }> = []

      for (const wf of batch as any[]) {
        if (existingWorkflowIds.has(wf.id)) {
          console.log(`  [SKIP] ${wf.id} (${wf.name}) - already has deployment version`)
          skipCount++
          continue
        }

        let state: WorkflowState | null = null

        if (wf.deployedState) {
          state = wf.deployedState as WorkflowState
          console.log(`  [DEPLOYED] ${wf.id} (${wf.name}) - using existing deployedState`)
        } else {
          const normalized = await loadWorkflowFromNormalizedTables(wf.id)
          if (normalized) {
            state = {
              blocks: normalized.blocks,
              edges: normalized.edges,
              loops: normalized.loops,
              parallels: normalized.parallels,
            }
            console.log(
              `  [NORMALIZED] ${wf.id} (${wf.name}) - loaded from normalized tables (was deployed: ${wf.isDeployed})`
            )
          } else {
            console.log(`  [SKIP] ${wf.id} (${wf.name}) - no state available`)
            skipCount++
            continue
          }
        }

        if (state) {
          deploymentVersions.push({
            id: uuidv4(),
            workflowId: wf.id,
            version: 1,
            state,
            createdAt: wf.deployedAt || new Date(),
            createdBy: wf.userId || 'migration',
            isActive: true,
          })
          successCount++
        }
      }

      if (deploymentVersions.length > 0) {
        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would insert ${deploymentVersions.length} deployment versions`)
          console.log(`  [DRY RUN] Would mark ${deploymentVersions.length} workflows as deployed`)
        } else {
          try {
            await db.insert(workflowDeploymentVersion).values(deploymentVersions)
            console.log(`  [SUCCESS] Inserted ${deploymentVersions.length} deployment versions`)

            const workflowIds = deploymentVersions.map((v) => v.workflowId)
            await db
              .update(workflow)
              .set({
                isDeployed: true,
                deployedAt: new Date(),
              })
              .where(
                sql`${workflow.id} IN (${sql.join(
                  workflowIds.map((id) => sql`${id}`),
                  sql`, `
                )})`
              )
            console.log(`  [SUCCESS] Marked ${workflowIds.length} workflows as deployed`)
          } catch (error) {
            console.error(`  [ERROR] Failed to insert batch:`, error)
            errorCount += deploymentVersions.length
            successCount -= deploymentVersions.length
          }
        }
      }
    }

    console.log('\n---')
    console.log('Migration Summary:')
    console.log(`  Success: ${successCount} workflows`)
    console.log(`  Skipped: ${skipCount} workflows`)
    console.log(`  Errors: ${errorCount} workflows`)

    if (DRY_RUN) {
      console.log('\n[DRY RUN] No changes were made to the database.')
      console.log('Run without --dry-run flag to apply changes.')
    } else {
      console.log('\nMigration completed successfully!')
    }
  } catch (error) {
    console.error('Fatal error during migration:', error)
    process.exit(1)
  } finally {
    try {
      await postgresClient.end({ timeout: 5 })
    } catch {}
  }
}

migrateWorkflows()
  .then(() => {
    console.log('\nDone!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Unexpected error:', error)
    process.exit(1)
  })
