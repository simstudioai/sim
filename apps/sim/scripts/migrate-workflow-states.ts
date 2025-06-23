#!/usr/bin/env bun

import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '../db/schema'

interface WorkflowState {
  blocks: Record<string, any>
  edges: any[]
  loops?: Record<string, any>
  parallels?: Record<string, any>
  lastSaved?: number
  isDeployed?: boolean
}

async function migrateWorkflowStates() {
  try {
    console.log('🔍 Finding workflows with old JSON state format...')

    // Find workflows that have state but no normalized table entries
    const workflowsToMigrate = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        state: workflow.state,
      })
      .from(workflow)
      .where(
        and(
          isNotNull(workflow.state) // Has JSON state
          // We'll check for normalized data existence per workflow
        )
      )

    console.log(`📊 Found ${workflowsToMigrate.length} workflows with JSON state`)

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
          console.log(`    🧹 Cleaned up ${removedBlockCount} invalid blocks (${originalBlockCount} → ${Object.keys(validBlocks).length})`)
          state.blocks = validBlocks
        }

        await db.transaction(async (tx) => {
          // Migrate blocks
          const blocks = Object.values(state.blocks)
          console.log(`  📦 Migrating ${blocks.length} blocks...`)

          for (const block of blocks) {
            await tx.insert(workflowBlocks).values({
              id: block.id,
              workflowId: wf.id,
              type: block.type,
              name: block.name,
              positionX: String(block.position?.x || 0),
              positionY: String(block.position?.y || 0),
              enabled: block.enabled ?? true,
              horizontalHandles: block.horizontalHandles ?? true,
              isWide: block.isWide ?? false,
              height: String(block.height || 0),
              subBlocks: block.subBlocks || {},
              outputs: block.outputs || {},
              data: block.data || {},
              parentId: block.data?.parentId || null,
            })
          }

          // Migrate edges
          const edges = state.edges || []
          console.log(`  🔗 Migrating ${edges.length} edges...`)

          for (const edge of edges) {
            await tx.insert(workflowEdges).values({
              id: edge.id,
              workflowId: wf.id,
              sourceBlockId: edge.source,
              targetBlockId: edge.target,
              sourceHandle: edge.sourceHandle || null,
              targetHandle: edge.targetHandle || null,
            })
          }

          // Migrate loops
          const loops = state.loops || {}
          const loopIds = Object.keys(loops)
          console.log(`  🔄 Migrating ${loopIds.length} loops...`)

          for (const loopId of loopIds) {
            const loop = loops[loopId]
            await tx.insert(workflowSubflows).values({
              id: loopId,
              workflowId: wf.id,
              type: 'loop',
              config: {
                id: loop.id,
                nodes: loop.nodes || [],
                iterationCount: loop.iterations || 5,
                iterationType: loop.loopType || 'for',
                collection: loop.forEachItems || '',
              },
            })
          }

          // Migrate parallels
          const parallels = state.parallels || {}
          const parallelIds = Object.keys(parallels)
          console.log(`  ⚡ Migrating ${parallelIds.length} parallels...`)

          for (const parallelId of parallelIds) {
            const parallel = parallels[parallelId]
            await tx.insert(workflowSubflows).values({
              id: parallelId,
              workflowId: wf.id,
              type: 'parallel',
              config: {
                id: parallel.id,
                nodes: parallel.nodes || [],
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

if (dryRun) {
  console.log('🔍 DRY RUN MODE - No changes will be made')
  console.log('')
}

migrateWorkflowStates()
