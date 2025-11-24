import { db } from '@sim/db'
import { workflowBlocks } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('LazyCleanup')

/**
 * Extract valid field names from a child workflow's start block inputFormat
 *
 * @param childWorkflowBlocks - The blocks from the child workflow state
 * @returns Set of valid field names defined in the child's inputFormat
 */
function extractValidInputFieldNames(childWorkflowBlocks: Record<string, any>): Set<string> | null {
  const validFieldNames = new Set<string>()

  const startBlock = Object.values(childWorkflowBlocks).find((block: any) => {
    const blockType = block?.type
    return blockType === 'start_trigger' || blockType === 'input_trigger' || blockType === 'starter'
  })

  if (!startBlock) {
    logger.debug('No start block found in child workflow')
    return null
  }

  const inputFormat =
    (startBlock as any)?.subBlocks?.inputFormat?.value ??
    (startBlock as any)?.config?.params?.inputFormat

  if (!Array.isArray(inputFormat)) {
    logger.debug('No inputFormat array found in child workflow start block')
    return null
  }

  // Extract field names
  for (const field of inputFormat) {
    if (field?.name && typeof field.name === 'string') {
      const fieldName = field.name.trim()
      if (fieldName) {
        validFieldNames.add(fieldName)
      }
    }
  }

  return validFieldNames
}

/**
 * Clean up orphaned inputMapping fields that don't exist in child workflow's inputFormat.
 * This is a lazy cleanup that only runs at execution time and only persists if changes are needed.
 *
 * @param parentWorkflowId - The parent workflow ID
 * @param parentBlockId - The workflow block ID in the parent
 * @param currentInputMapping - The current inputMapping value from the parent block
 * @param childWorkflowBlocks - The blocks from the child workflow
 * @returns The cleaned inputMapping (only different if cleanup was needed)
 */
export async function lazyCleanupInputMapping(
  parentWorkflowId: string,
  parentBlockId: string,
  currentInputMapping: any,
  childWorkflowBlocks: Record<string, any>
): Promise<any> {
  try {
    if (
      !currentInputMapping ||
      typeof currentInputMapping !== 'object' ||
      Array.isArray(currentInputMapping)
    ) {
      return currentInputMapping
    }

    const validFieldNames = extractValidInputFieldNames(childWorkflowBlocks)

    if (!validFieldNames || validFieldNames.size === 0) {
      logger.debug('Child workflow has no inputFormat fields, skipping cleanup')
      return currentInputMapping
    }

    const orphanedFields: string[] = []
    for (const fieldName of Object.keys(currentInputMapping)) {
      if (!validFieldNames.has(fieldName)) {
        orphanedFields.push(fieldName)
      }
    }

    if (orphanedFields.length === 0) {
      return currentInputMapping
    }

    const cleanedMapping: Record<string, any> = {}
    for (const [fieldName, fieldValue] of Object.entries(currentInputMapping)) {
      if (validFieldNames.has(fieldName)) {
        cleanedMapping[fieldName] = fieldValue
      }
    }

    logger.info(
      `Lazy cleanup: Removing ${orphanedFields.length} orphaned field(s) from inputMapping in workflow ${parentWorkflowId}, block ${parentBlockId}: ${orphanedFields.join(', ')}`
    )

    persistCleanedMapping(parentWorkflowId, parentBlockId, cleanedMapping).catch((error) => {
      logger.error('Failed to persist cleaned inputMapping:', error)
    })

    return cleanedMapping
  } catch (error) {
    logger.error('Error in lazy cleanup:', error)
    return currentInputMapping
  }
}

/**
 * Persist the cleaned inputMapping to the database
 *
 * @param workflowId - The workflow ID
 * @param blockId - The block ID
 * @param cleanedMapping - The cleaned inputMapping value
 */
async function persistCleanedMapping(
  workflowId: string,
  blockId: string,
  cleanedMapping: Record<string, any>
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [block] = await tx
        .select({ subBlocks: workflowBlocks.subBlocks })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
        .limit(1)

      if (!block) {
        logger.warn(`Block ${blockId} not found in workflow ${workflowId}, skipping persistence`)
        return
      }

      const subBlocks = (block.subBlocks as Record<string, any>) || {}

      if (subBlocks.inputMapping) {
        subBlocks.inputMapping = {
          ...subBlocks.inputMapping,
          value: cleanedMapping,
        }

        // Persist updated subBlocks
        await tx
          .update(workflowBlocks)
          .set({
            subBlocks: subBlocks,
            updatedAt: new Date(),
          })
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))

        logger.info(`Successfully persisted cleaned inputMapping for block ${blockId}`)
      }
    })
  } catch (error) {
    logger.error('Error persisting cleaned mapping:', error)
    throw error
  }
}
