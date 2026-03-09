import { db } from '@sim/db'
import { credential, environment, workflow, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  syncPersonalEnvCredentialsForUser,
  syncWorkspaceEnvCredentials,
} from '@/lib/credentials/environment'

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
    name: 'set_environment_variables',
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
        const [wf] = await db
          .select({ workspaceId: workflow.workspaceId })
          .from(workflow)
          .where(eq(workflow.id, workflowId))
          .limit(1)

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

      const added: string[] = []
      const updated: string[] = []
      const workspaceUpdated: string[] = []

      if (Object.keys(personalVars).length > 0) {
        const existingData = await db
          .select()
          .from(environment)
          .where(eq(environment.userId, authenticatedUserId))
          .limit(1)
        const existingEncrypted = (existingData[0]?.variables as Record<string, string>) || {}

        const toEncrypt: Record<string, string> = {}
        for (const [key, newVal] of Object.entries(personalVars)) {
          if (!(key in existingEncrypted)) {
            toEncrypt[key] = newVal
            added.push(key)
          } else {
            try {
              const { decrypted } = await decryptSecret(existingEncrypted[key])
              if (decrypted !== newVal) {
                toEncrypt[key] = newVal
                updated.push(key)
              }
            } catch {
              toEncrypt[key] = newVal
              updated.push(key)
            }
          }
        }

        const newlyEncrypted = await Object.entries(toEncrypt).reduce(
          async (accP, [key, val]) => {
            const acc = await accP
            const { encrypted } = await encryptSecret(val)
            return { ...acc, [key]: encrypted }
          },
          Promise.resolve({} as Record<string, string>)
        )

        const finalEncrypted = { ...existingEncrypted, ...newlyEncrypted }

        await db
          .insert(environment)
          .values({
            id: crypto.randomUUID(),
            userId: authenticatedUserId,
            variables: finalEncrypted,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [environment.userId],
            set: { variables: finalEncrypted, updatedAt: new Date() },
          })

        await syncPersonalEnvCredentialsForUser({
          userId: authenticatedUserId,
          envKeys: Object.keys(finalEncrypted),
        })
      }

      if (Object.keys(workspaceVars).length > 0 && resolvedWorkspaceId) {
        const wsRows = await db
          .select()
          .from(workspaceEnvironment)
          .where(eq(workspaceEnvironment.workspaceId, resolvedWorkspaceId))
          .limit(1)

        const existingWsEncrypted = (wsRows[0]?.variables as Record<string, string>) || {}

        const toEncryptWs: Record<string, string> = {}
        for (const [key, newVal] of Object.entries(workspaceVars)) {
          toEncryptWs[key] = newVal
          workspaceUpdated.push(key)
        }

        const newlyEncryptedWs = await Object.entries(toEncryptWs).reduce(
          async (accP, [key, val]) => {
            const acc = await accP
            const { encrypted } = await encryptSecret(val)
            return { ...acc, [key]: encrypted }
          },
          Promise.resolve({} as Record<string, string>)
        )

        const mergedWs = { ...existingWsEncrypted, ...newlyEncryptedWs }

        await db
          .insert(workspaceEnvironment)
          .values({
            id: crypto.randomUUID(),
            workspaceId: resolvedWorkspaceId,
            variables: mergedWs,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [workspaceEnvironment.workspaceId],
            set: { variables: mergedWs, updatedAt: new Date() },
          })

        await syncWorkspaceEnvCredentials({
          workspaceId: resolvedWorkspaceId,
          envKeys: Object.keys(workspaceVars),
          actingUserId: authenticatedUserId,
        })
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
