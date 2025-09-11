import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { authenticateApiKey, isHashedKey, migrateKeyToHashed } from '@/lib/security/api-key-auth'
import { getWorkflowById } from '@/lib/workflows/utils'
import { db } from '@/db'
import { apiKey, workspace, workspaceApiKey } from '@/db/schema'

const logger = createLogger('WorkflowMiddleware')

export interface ValidationResult {
  error?: { message: string; status: number }
  workflow?: any
}

export async function validateWorkflowAccess(
  request: NextRequest,
  workflowId: string,
  requireDeployment = true
): Promise<ValidationResult> {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      return {
        error: {
          message: 'Workflow not found',
          status: 404,
        },
      }
    }

    if (requireDeployment) {
      if (!workflow.isDeployed) {
        return {
          error: {
            message: 'Workflow is not deployed',
            status: 403,
          },
        }
      }

      // API key authentication
      let apiKeyHeader = null
      for (const [key, value] of request.headers.entries()) {
        if (key.toLowerCase() === 'x-api-key' && value) {
          apiKeyHeader = value
          break
        }
      }

      if (!apiKeyHeader) {
        return {
          error: {
            message: 'Unauthorized: API key required',
            status: 401,
          },
        }
      }

      // If a pinned key exists, only accept that specific key
      if (workflow.pinnedApiKey) {
        if (workflow.pinnedApiKey !== apiKeyHeader) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
        }
      } else {
        // Check both personal API keys and workspace API keys

        // First, check personal API keys belonging to the workflow owner
        const personalKeys = await db
          .select({
            id: apiKey.id,
            key: apiKey.key,
          })
          .from(apiKey)
          .where(eq(apiKey.userId, workflow.userId))

        let validPersonalKey = null

        // Check each personal key with authentication function
        for (const key of personalKeys) {
          const isValid = await authenticateApiKey(apiKeyHeader, key.key)
          if (isValid) {
            validPersonalKey = key
            break
          }
        }

        // If not found in personal keys, check workspace API keys
        let validWorkspaceKey = null
        if (!validPersonalKey) {
          const workspaceKeys = await db
            .select({
              id: workspaceApiKey.id,
              key: workspaceApiKey.key,
              workspaceId: workspaceApiKey.workspaceId,
            })
            .from(workspaceApiKey)
            .leftJoin(workspace, eq(workspaceApiKey.workspaceId, workspace.id))
            .where(eq(workspace.id, workflow.workspaceId)) // Key must belong to the same workspace as the workflow

          // Check each workspace key with authentication function
          for (const key of workspaceKeys) {
            const isValid = await authenticateApiKey(apiKeyHeader, key.key)
            if (isValid) {
              validWorkspaceKey = key
              break
            }
          }
        }

        // If neither personal nor workspace key is valid, reject
        if (!validPersonalKey && !validWorkspaceKey) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
        }

        // Update last used and potentially migrate to hashed format
        if (validPersonalKey) {
          const updates: any = { lastUsed: new Date() }

          // If this is a plain text key, migrate it to hashed format
          if (!isHashedKey(validPersonalKey.key)) {
            try {
              const hashedKey = await migrateKeyToHashed(apiKeyHeader)
              updates.key = hashedKey
              logger.info('Migrated personal API key to hashed format', {
                keyId: validPersonalKey.id,
              })
            } catch (error) {
              logger.error('Failed to migrate personal API key to hashed format', {
                keyId: validPersonalKey.id,
                error,
              })
              // Continue without migration on error
            }
          }

          await db.update(apiKey).set(updates).where(eq(apiKey.id, validPersonalKey.id))
        } else if (validWorkspaceKey) {
          const updates: any = { lastUsed: new Date() }

          // If this is a plain text key, migrate it to hashed format
          if (!isHashedKey(validWorkspaceKey.key)) {
            try {
              const hashedKey = await migrateKeyToHashed(apiKeyHeader)
              updates.key = hashedKey
              logger.info('Migrated workspace API key to hashed format', {
                keyId: validWorkspaceKey.id,
              })
            } catch (error) {
              logger.error('Failed to migrate workspace API key to hashed format', {
                keyId: validWorkspaceKey.id,
                error,
              })
              // Continue without migration on error
            }
          }

          await db
            .update(workspaceApiKey)
            .set(updates)
            .where(eq(workspaceApiKey.id, validWorkspaceKey.id))
        }
      }
    }
    return { workflow }
  } catch (error) {
    logger.error('Validation error:', { error })
    return {
      error: {
        message: 'Internal server error',
        status: 500,
      },
    }
  }
}
