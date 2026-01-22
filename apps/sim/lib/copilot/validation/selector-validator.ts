import { db } from '@sim/db'
import { account, document, knowledgeBase, mcpServers, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'

const logger = createLogger('SelectorValidator')

/**
 * Result of selector ID validation
 */
export interface SelectorValidationResult {
  valid: string[]
  invalid: string[]
  warning?: string
}

/**
 * Validates that selector IDs exist in the database
 * Returns valid IDs, invalid IDs, and optional warning for unknown selector types
 */
export async function validateSelectorIds(
  selectorType: string,
  ids: string | string[],
  context: { userId: string; workspaceId?: string }
): Promise<SelectorValidationResult> {
  const idsArray = (Array.isArray(ids) ? ids : [ids]).filter((id) => id && id.trim() !== '')
  if (idsArray.length === 0) {
    return { valid: [], invalid: [] }
  }

  let existingIds: string[] = []

  try {
    switch (selectorType) {
      case 'oauth-input': {
        // Credentials must belong to the user
        const results = await db
          .select({ id: account.id })
          .from(account)
          .where(and(inArray(account.id, idsArray), eq(account.userId, context.userId)))
        existingIds = results.map((r) => r.id)

        // If any IDs are invalid, fetch user's available credentials to include in error message
        const existingSet = new Set(existingIds)
        const invalidIds = idsArray.filter((id) => !existingSet.has(id))
        if (invalidIds.length > 0) {
          // Fetch all of the user's credentials to provide helpful feedback
          const allUserCredentials = await db
            .select({ id: account.id, providerId: account.providerId })
            .from(account)
            .where(eq(account.userId, context.userId))

          const availableCredentials = allUserCredentials
            .map((c) => `${c.id} (${c.providerId})`)
            .join(', ')
          const noCredentialsMessage = 'User has no credentials configured.'

          return {
            valid: existingIds,
            invalid: invalidIds,
            warning:
              allUserCredentials.length > 0
                ? `Available credentials for this user: ${availableCredentials}`
                : noCredentialsMessage,
          }
        }
        break
      }

      case 'knowledge-base-selector': {
        // Knowledge bases - check if they exist (workspace check optional)
        const conditions = [inArray(knowledgeBase.id, idsArray)]
        if (context.workspaceId) {
          conditions.push(eq(knowledgeBase.workspaceId, context.workspaceId))
        }
        const results = await db
          .select({ id: knowledgeBase.id })
          .from(knowledgeBase)
          .where(and(...conditions))
        existingIds = results.map((r) => r.id)
        break
      }

      case 'workflow-selector': {
        // Workflows - check if they exist
        const results = await db
          .select({ id: workflow.id })
          .from(workflow)
          .where(inArray(workflow.id, idsArray))
        existingIds = results.map((r) => r.id)
        break
      }

      case 'document-selector': {
        // Documents in knowledge bases - check if they exist and are not deleted
        const results = await db
          .select({ id: document.id })
          .from(document)
          .where(and(inArray(document.id, idsArray), isNull(document.deletedAt)))
        existingIds = results.map((r) => r.id)
        break
      }

      case 'mcp-server-selector': {
        // MCP servers - check if they exist, are enabled, and not deleted in the workspace
        const conditions = [
          inArray(mcpServers.id, idsArray),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt),
        ]
        if (context.workspaceId) {
          conditions.push(eq(mcpServers.workspaceId, context.workspaceId))
        }
        const results = await db
          .select({ id: mcpServers.id })
          .from(mcpServers)
          .where(and(...conditions))
        existingIds = results.map((r) => r.id)
        break
      }

      // MCP tools are dynamically fetched from external MCP servers at runtime
      // We can't validate tool IDs locally - only the server connection validates them
      case 'mcp-tool-selector': {
        return { valid: idsArray, invalid: [] }
      }

      // These selectors use external IDs from third-party systems (Slack, Google, Jira, etc.)
      // We can't validate them locally - they're validated at runtime when calling the external API
      case 'file-selector':
      case 'project-selector':
      case 'channel-selector':
      case 'folder-selector': {
        // External/dynamic selectors - skip validation, IDs are validated at runtime
        // These IDs come from: Slack channels, Google Drive files, Jira projects, etc.
        return { valid: idsArray, invalid: [] }
      }

      default: {
        // Unknown selector type - skip validation but warn
        logger.warn(`Unknown selector type "${selectorType}" - ID validation skipped`, {
          selectorType,
          idCount: idsArray.length,
        })
        return {
          valid: idsArray,
          invalid: [],
          warning: `Unknown selector type "${selectorType}" - ID validation skipped`,
        }
      }
    }
  } catch (error) {
    // On DB error, skip validation rather than failing the edit
    logger.error(`Failed to validate selector IDs for type "${selectorType}"`, {
      error: error instanceof Error ? error.message : String(error),
      selectorType,
      idCount: idsArray.length,
    })
    return {
      valid: idsArray,
      invalid: [],
      warning: `Failed to validate ${selectorType} IDs - validation skipped`,
    }
  }

  const existingSet = new Set(existingIds)
  return {
    valid: idsArray.filter((id) => existingSet.has(id)),
    invalid: idsArray.filter((id) => !existingSet.has(id)),
  }
}

/**
 * Batch validate multiple selector fields
 * Returns a map of field name to validation result
 */
export async function validateAllSelectorFields(
  fields: Array<{ fieldName: string; selectorType: string; value: string | string[] }>,
  context: { userId: string; workspaceId?: string }
): Promise<Map<string, SelectorValidationResult>> {
  const results = new Map<string, SelectorValidationResult>()

  // Run validations in parallel for better performance
  const validationPromises = fields.map(async ({ fieldName, selectorType, value }) => {
    const result = await validateSelectorIds(selectorType, value, context)
    return { fieldName, result }
  })

  const validationResults = await Promise.all(validationPromises)

  for (const { fieldName, result } of validationResults) {
    results.set(fieldName, result)
  }

  return results
}
