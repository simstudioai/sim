import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { SetEnvironmentVariables } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { upsertPersonalEnvVars, upsertWorkspaceEnvVars } from '@/lib/environment/utils'
import { getWorkflowById } from '@/lib/workflows/utils'

interface SetEnvironmentVariablesParams {
  variables: Record<string, any> | Array<{ name: string; value: string }>
  workflowId?: string
}

const EnvVarSchema = z.object({ variables: z.record(z.string()) })

function normalizeVariables(
  input: Record<string, any> | Array<{ name: string; value: string }>
): Record<string, string> {
  if (Array.isArray(input)) {
    return input.reduce(
      (acc, item) => {
        if (item && typeof item.name === 'string') {
          acc[item.name] = String(item.value ?? '')
        }
        return acc
      },
      {} as Record<string, string>
    )
  }
  return Object.fromEntries(
    Object.entries(input || {}).map(([k, v]) => [k, String(v ?? '')])
  ) as Record<string, string>
}

export const setEnvironmentVariablesServerTool: BaseServerTool<SetEnvironmentVariablesParams, any> =
  {
    name: SetEnvironmentVariables.id,
    async execute(
      params: SetEnvironmentVariablesParams,
      context?: { userId: string }
    ): Promise<any> {
      const logger = createLogger('SetEnvironmentVariablesServerTool')

      if (!context?.userId) {
        logger.error(
          'Unauthorized attempt to set environment variables - no authenticated user context'
        )
        throw new Error('Authentication required')
      }

      const authenticatedUserId = context.userId
      const { variables } = params || ({} as SetEnvironmentVariablesParams)

      const normalized = normalizeVariables(variables || {})
      const { variables: validatedVariables } = EnvVarSchema.parse({ variables: normalized })

      const requestedKeys = Object.keys(validatedVariables)
      const workflowId = params.workflowId

      const workspaceKeySet = new Set<string>()
      let resolvedWorkspaceId: string | null = null

      if (requestedKeys.length > 0 && workflowId) {
        const wf = await getWorkflowById(workflowId)

        if (wf?.workspaceId) {
          resolvedWorkspaceId = wf.workspaceId
          const existingWorkspaceCredentials = await db
            .select({ envKey: credential.envKey })
            .from(credential)
            .where(
              and(
                eq(credential.workspaceId, wf.workspaceId),
                eq(credential.type, 'env_workspace'),
                inArray(credential.envKey, requestedKeys)
              )
            )

          for (const row of existingWorkspaceCredentials) {
            if (row.envKey) workspaceKeySet.add(row.envKey)
          }
        }
      }

      const personalVars: Record<string, string> = {}
      const workspaceVars: Record<string, string> = {}

      for (const [key, value] of Object.entries(validatedVariables)) {
        if (workspaceKeySet.has(key)) {
          workspaceVars[key] = value
        } else {
          personalVars[key] = value
        }
      }

      const { added, updated } = await upsertPersonalEnvVars(authenticatedUserId, personalVars)

      let workspaceUpdated: string[] = []
      if (Object.keys(workspaceVars).length > 0 && resolvedWorkspaceId) {
        workspaceUpdated = await upsertWorkspaceEnvVars(
          resolvedWorkspaceId,
          workspaceVars,
          authenticatedUserId
        )
      }

      const totalProcessed = added.length + updated.length + workspaceUpdated.length

      logger.info('Saved environment variables', {
        userId: authenticatedUserId,
        addedCount: added.length,
        updatedCount: updated.length,
        workspaceUpdatedCount: workspaceUpdated.length,
      })

      const parts: string[] = []
      if (added.length > 0) parts.push(`${added.length} personal secret(s) added`)
      if (updated.length > 0) parts.push(`${updated.length} personal secret(s) updated`)
      if (workspaceUpdated.length > 0)
        parts.push(`${workspaceUpdated.length} workspace secret(s) updated`)

      return {
        message: `Successfully processed ${totalProcessed} secret(s): ${parts.join(', ')}`,
        variableCount: Object.keys(validatedVariables).length,
        variableNames: Object.keys(validatedVariables),
        addedVariables: added,
        updatedVariables: updated,
        workspaceUpdatedVariables: workspaceUpdated,
      }
    },
  }
