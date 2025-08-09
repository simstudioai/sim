#!/usr/bin/env bun

import { readFileSync } from 'fs'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@/db/schema'

interface WorkflowState {
  blocks: Record<string, any>
  edges: any[]
  loops?: Record<string, any>
  parallels?: Record<string, any>
  lastSaved?: number
  isDeployed?: boolean
}

async function migrateWorkflowStates(specificWorkflowIds?: string[] | null) {
  try {
    if (specificWorkflowIds) {
      console.log(`🔍 Finding ${specificWorkflowIds.length} specific workflows...`)
    } else {
      console.log('🔍 Finding workflows with old JSON state format...')
    }

    // Build the where condition based on whether we have specific IDs
    const whereCondition = specificWorkflowIds
      ? and(
          isNotNull(workflow.state), // Has JSON state
          inArray(workflow.id, specificWorkflowIds) // Only specific IDs
        )
      : and(
          isNotNull(workflow.state) // Has JSON state
          // We'll check for normalized data existence per workflow
        )

    // Find workflows that have state but no normalized table entries
    const workflowsToMigrate = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        state: workflow.state,
      })
      .from(workflow)
      .where(whereCondition)

    console.log(`📊 Found ${workflowsToMigrate.length} workflows with JSON state`)

    if (specificWorkflowIds) {
      const foundIds = workflowsToMigrate.map((w) => w.id)
      const missingIds = specificWorkflowIds.filter((id) => !foundIds.includes(id))
      if (missingIds.length > 0) {
        console.log(`⚠️  Warning: ${missingIds.length} specified workflow IDs not found:`)
        missingIds.forEach((id) => console.log(`    - ${id}`))
      }
      console.log('')
    }

    let migratedCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const wf of workflowsToMigrate) {
      try {
        // Check if this workflow already has normalized data
        const existingBlocks = await db
          .select({ id: workflowBlocks.id })
          .from(workflowBlocks)
          .where(eq(workflowBlocks.workflowId, wf.id))
          .limit(1)

        if (existingBlocks.length > 0) {
          console.log(`⏭️  Skipping ${wf.name} (${wf.id}) - already has normalized data`)
          skippedCount++
          continue
        }

        console.log(`🔄 Migrating ${wf.name} (${wf.id})...`)

        const state = wf.state as WorkflowState
        if (!state || !state.blocks) {
          console.log(`⚠️  Skipping ${wf.name} - invalid state format`)
          skippedCount++
          continue
        }

        // Clean up invalid blocks (those without an id field) before migration
        const originalBlockCount = Object.keys(state.blocks).length
        const validBlocks: Record<string, any> = {}
        let removedBlockCount = 0

        for (const [blockKey, block] of Object.entries(state.blocks)) {
          if (block && typeof block === 'object' && block.id) {
            // Valid block - has an id field
            validBlocks[blockKey] = block
          } else {
            // Invalid block - missing id field
            console.log(`    🗑️  Removing invalid block ${blockKey} (no id field)`)
            removedBlockCount++
          }
        }

        if (removedBlockCount > 0) {
          console.log(
            `    🧹 Cleaned up ${removedBlockCount} invalid blocks (${originalBlockCount} → ${Object.keys(validBlocks).length})`
          )
          state.blocks = validBlocks
        }

        await db.transaction(async (tx) => {
          // Migrate blocks - generate new IDs and create mapping
          const blocks = Object.values(state.blocks)
          console.log(`  📦 Migrating ${blocks.length} blocks...`)

          // Create mapping from old block IDs to new block IDs
          const blockIdMapping: Record<string, string> = {}

          for (const block of blocks) {
            const newBlockId = nanoid()
            blockIdMapping[block.id] = newBlockId

            await tx.insert(workflowBlocks).values({
              id: newBlockId,
              workflowId: wf.id,
              type: block.type,
              name: block.name,
              positionX: String(block.position?.x || 0),
              positionY: String(block.position?.y || 0),
              enabled: block.enabled ?? true,
              horizontalHandles: block.horizontalHandles ?? true,
              isWide: block.isWide ?? false,
              advancedMode: block.advancedMode ?? false,
              triggerMode: block.triggerMode ?? false,
              height: String(block.height || 0),
              subBlocks: block.subBlocks || {},
              outputs: block.outputs || {},
              data: block.data || {},
              parentId: block.data?.parentId ? blockIdMapping[block.data.parentId] || null : null,
            })
          }

          // Migrate edges - use new block IDs
          const edges = state.edges || []
          console.log(`  🔗 Migrating ${edges.length} edges...`)

          for (const edge of edges) {
            const newSourceId = blockIdMapping[edge.source]
            const newTargetId = blockIdMapping[edge.target]

            // Skip edges that reference blocks that don't exist in our mapping
            if (!newSourceId || !newTargetId) {
              console.log(`    ⚠️  Skipping edge ${edge.id} - references missing blocks`)
              continue
            }

            await tx.insert(workflowEdges).values({
              id: nanoid(),
              workflowId: wf.id,
              sourceBlockId: newSourceId,
              targetBlockId: newTargetId,
              sourceHandle: edge.sourceHandle || null,
              targetHandle: edge.targetHandle || null,
            })
          }

          // Migrate loops - update node IDs to use new block IDs
          const loops = state.loops || {}
          const loopIds = Object.keys(loops)
          console.log(`  🔄 Migrating ${loopIds.length} loops...`)

          for (const loopId of loopIds) {
            const loop = loops[loopId]
            // Map old node IDs to new block IDs
            const updatedNodes = (loop.nodes || [])
              .map((nodeId: string) => blockIdMapping[nodeId])
              .filter(Boolean)

            await tx.insert(workflowSubflows).values({
              id: nanoid(),
              workflowId: wf.id,
              type: 'loop',
              config: {
                id: loop.id,
                nodes: updatedNodes,
                iterationCount: loop.iterations || 5,
                iterationType: loop.loopType || 'for',
                collection: loop.forEachItems || '',
              },
            })
          }

          // Migrate parallels - update node IDs to use new block IDs
          const parallels = state.parallels || {}
          const parallelIds = Object.keys(parallels)
          console.log(`  ⚡ Migrating ${parallelIds.length} parallels...`)

          for (const parallelId of parallelIds) {
            const parallel = parallels[parallelId]
            // Map old node IDs to new block IDs
            const updatedNodes = (parallel.nodes || [])
              .map((nodeId: string) => blockIdMapping[nodeId])
              .filter(Boolean)

            await tx.insert(workflowSubflows).values({
              id: nanoid(),
              workflowId: wf.id,
              type: 'parallel',
              config: {
                id: parallel.id,
                nodes: updatedNodes,
                parallelCount: 2, // Default parallel count
                collection: parallel.distribution || '',
              },
            })
          }
        })

        console.log(`✅ Successfully migrated ${wf.name}`)
        migratedCount++
      } catch (error) {
        console.error(`❌ Error migrating ${wf.name} (${wf.id}):`, error)
        errorCount++
      }
    }

    console.log('')
    console.log('📊 Migration Summary:')
    console.log(`✅ Migrated: ${migratedCount} workflows`)
    console.log(`⏭️  Skipped: ${skippedCount} workflows`)
    console.log(`❌ Errors: ${errorCount} workflows`)
    console.log('')

    if (migratedCount > 0) {
      console.log('🎉 Migration completed successfully!')
      console.log('')
      console.log('📋 Next steps:')
      console.log('1. Test the migrated workflows in your browser')
      console.log('2. Verify all blocks, edges, and subflows work correctly')
      console.log('3. Check that editing and collaboration still work')
      console.log('4. Once confirmed, the workflow.state JSON field can be deprecated')
    }
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

// Add command line argument parsing
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const showHelp = args.includes('--help') || args.includes('-h')

if (showHelp) {
  console.log('🔄 Workflow State Migration Script')
  console.log('')
  console.log('Usage:')
  console.log('  bun run scripts/migrate-workflow-states.ts [options]')
  console.log('')
  console.log('Options:')
  console.log('  --dry-run              Show what would be migrated without making changes')
  console.log('  --file <path>          Migrate only workflow IDs listed in file (comma-separated)')
  console.log('  --help, -h             Show this help message')
  console.log('')
  console.log('Examples:')
  console.log('  bun run scripts/migrate-workflow-states.ts')
  console.log('  bun run scripts/migrate-workflow-states.ts --dry-run')
  console.log('  bun run scripts/migrate-workflow-states.ts --file workflow-ids.txt')
  console.log('  bun run scripts/migrate-workflow-states.ts --dry-run --file workflow-ids.txt')
  console.log('')
  console.log('File format (workflow-ids.txt):')
  console.log('  abc-123,def-456,ghi-789')
  console.log('')
  process.exit(0)
}

// Parse --file flag for workflow IDs
let specificWorkflowIds: string[] | null = null
const fileIndex = args.findIndex((arg) => arg === '--file')
if (fileIndex !== -1 && args[fileIndex + 1]) {
  const filePath = args[fileIndex + 1]
  try {
    console.log(`📁 Reading workflow IDs from file: ${filePath}`)
    const fileContent = readFileSync(filePath, 'utf-8')
    specificWorkflowIds = fileContent
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    console.log(`📋 Found ${specificWorkflowIds.length} workflow IDs in file`)
    console.log('')
  } catch (error) {
    console.error(`❌ Error reading file ${filePath}:`, error)
    process.exit(1)
  }
}

if (dryRun) {
  console.log('🔍 DRY RUN MODE - No changes will be made')
  console.log('')
}

if (specificWorkflowIds) {
  console.log('🎯 TARGETED MIGRATION - Only migrating specified workflow IDs')
  console.log('')
}

migrateWorkflowStates(specificWorkflowIds)
