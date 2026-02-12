import { db } from '@sim/db'
import { environment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { syncPersonalEnvCredentialsForUser } from '@/lib/credentials/environment'

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

      // Fetch existing personal environment variables
      const existingData = await db
        .select()
        .from(environment)
        .where(eq(environment.userId, authenticatedUserId))
        .limit(1)
      const existingEncrypted = (existingData[0]?.variables as Record<string, string>) || {}

      const toEncrypt: Record<string, string> = {}
      const added: string[] = []
      const updated: string[] = []
      for (const [key, newVal] of Object.entries(validatedVariables)) {
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

      // Save to personal environment variables (keyed by userId)
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

      logger.info('Saved personal environment variables', {
        userId: authenticatedUserId,
        addedCount: added.length,
        updatedCount: updated.length,
        totalCount: Object.keys(finalEncrypted).length,
      })

      return {
        message: `Successfully processed ${Object.keys(validatedVariables).length} personal environment variable(s): ${added.length} added, ${updated.length} updated`,
        variableCount: Object.keys(validatedVariables).length,
        variableNames: Object.keys(validatedVariables),
        totalVariableCount: Object.keys(finalEncrypted).length,
        addedVariables: added,
        updatedVariables: updated,
      }
    },
  }
