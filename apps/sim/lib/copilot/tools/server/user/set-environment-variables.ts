import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { decryptSecret, encryptSecret } from '@/lib/utils'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { environment } from '@/db/schema'

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
  // Ensure all values are strings
  return Object.fromEntries(
    Object.entries(input || {}).map(([k, v]) => [k, String(v ?? '')])
  ) as Record<string, string>
}

export const setEnvironmentVariablesServerTool: BaseServerTool<SetEnvironmentVariablesParams, any> =
  {
    name: 'set_environment_variables',
    async execute(params: SetEnvironmentVariablesParams): Promise<any> {
      const logger = createLogger('SetEnvironmentVariablesServerTool')
      const { variables, workflowId } = params || ({} as SetEnvironmentVariablesParams)

      const normalized = normalizeVariables(variables || {})
      const { variables: validatedVariables } = EnvVarSchema.parse({ variables: normalized })
      const userId = await getUserId('copilot-set-env-vars', workflowId)
      if (!userId) {
        logger.warn('Unauthorized set env vars attempt')
        throw new Error('Unauthorized')
      }

      // Fetch existing
      const existingData = await db
        .select()
        .from(environment)
        .where(eq(environment.userId, userId))
        .limit(1)
      const existingEncrypted = (existingData[0]?.variables as Record<string, string>) || {}

      // Diff and (re)encrypt
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

      await db
        .insert(environment)
        .values({
          id: crypto.randomUUID(),
          userId,
          variables: finalEncrypted,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [environment.userId],
          set: { variables: finalEncrypted, updatedAt: new Date() },
        })

      return {
        message: `Successfully processed ${Object.keys(validatedVariables).length} environment variable(s): ${added.length} added, ${updated.length} updated`,
        variableCount: Object.keys(validatedVariables).length,
        variableNames: Object.keys(validatedVariables),
        totalVariableCount: Object.keys(finalEncrypted).length,
        addedVariables: added,
        updatedVariables: updated,
      }
    },
  }
