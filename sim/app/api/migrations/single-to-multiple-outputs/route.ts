import { NextRequest } from 'next/server'
import { eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { chat } from '@/db/schema'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('MigrationAPI')

/**
 * Endpoint to migrate chat deployments from single block output to multiple block outputs
 * This will convert all deployments that have outputBlockId but empty outputBlocks
 */
export async function POST(request: NextRequest) {
  try {
    // Require admin authentication
    const session = await getSession()
    if (!session || session.user.email !== 'admin@simstudio.ai') {
      return createErrorResponse('Unauthorized', 401)
    }
    
    // Find all chat deployments with outputBlockId but no entries in outputBlocks
    const chatsToMigrate = await db
      .select({
        id: chat.id,
        outputBlockId: chat.outputBlockId,
        outputPath: chat.outputPath,
        outputBlocks: chat.outputBlocks,
      })
      .from(chat)
      .where(isNotNull(chat.outputBlockId))
    
    logger.info(`Found ${chatsToMigrate.length} chat deployments to migrate`)
    
    let migratedCount = 0
    let skippedCount = 0
    
    // Migrate each deployment
    for (const deployment of chatsToMigrate) {
      // Skip if outputBlocks is not empty array
      if (Array.isArray(deployment.outputBlocks) && deployment.outputBlocks.length > 0) {
        skippedCount++
        continue
      }
      
      // Create an outputBlocks entry from outputBlockId and outputPath
      const outputBlocks = [{
        blockId: deployment.outputBlockId,
        path: deployment.outputPath || undefined
      }]
      
      // Update the chat deployment
      await db
        .update(chat)
        .set({
          outputBlocks,
          updatedAt: new Date(),
        })
        .where(eq(chat.id, deployment.id))
      
      migratedCount++
    }
    
    logger.info(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped`)
    
    return createSuccessResponse({
      migrated: migratedCount,
      skipped: skippedCount,
      total: chatsToMigrate.length,
    })
  } catch (error: any) {
    logger.error('Error during migration:', error)
    return createErrorResponse(error.message || 'Migration failed', 500)
  }
} 