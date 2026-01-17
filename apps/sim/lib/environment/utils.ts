import { db } from '@sim/db'
import { environment, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'
import { REFERENCE } from '@/executor/constants'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('EnvironmentUtils')

/**
 * Get environment variable keys for a user
 * Returns only the variable names, not their values
 */
export async function getEnvironmentVariableKeys(userId: string): Promise<{
  variableNames: string[]
  count: number
}> {
  try {
    const result = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    if (!result.length || !result[0].variables) {
      return {
        variableNames: [],
        count: 0,
      }
    }

    // Get the keys (variable names) without decrypting values
    const encryptedVariables = result[0].variables as Record<string, string>
    const variableNames = Object.keys(encryptedVariables)

    return {
      variableNames,
      count: variableNames.length,
    }
  } catch (error) {
    logger.error('Error getting environment variable keys:', error)
    throw new Error('Failed to get environment variables')
  }
}

export async function getPersonalAndWorkspaceEnv(
  userId: string,
  workspaceId?: string
): Promise<{
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalDecrypted: Record<string, string>
  workspaceDecrypted: Record<string, string>
  conflicts: string[]
}> {
  const [personalRows, workspaceRows] = await Promise.all([
    db.select().from(environment).where(eq(environment.userId, userId)).limit(1),
    workspaceId
      ? db
          .select()
          .from(workspaceEnvironment)
          .where(eq(workspaceEnvironment.workspaceId, workspaceId))
          .limit(1)
      : Promise.resolve([] as any[]),
  ])

  const personalEncrypted: Record<string, string> = (personalRows[0]?.variables as any) || {}
  const workspaceEncrypted: Record<string, string> = (workspaceRows[0]?.variables as any) || {}

  const decryptAll = async (src: Record<string, string>) => {
    const entries = Object.entries(src)
    const results = await Promise.all(
      entries.map(async ([k, v]) => {
        try {
          const { decrypted } = await decryptSecret(v)
          return [k, decrypted] as const
        } catch {
          return [k, ''] as const
        }
      })
    )
    return Object.fromEntries(results)
  }

  const [personalDecrypted, workspaceDecrypted] = await Promise.all([
    decryptAll(personalEncrypted),
    decryptAll(workspaceEncrypted),
  ])

  const conflicts = Object.keys(personalEncrypted).filter((k) => k in workspaceEncrypted)

  return {
    personalEncrypted,
    workspaceEncrypted,
    personalDecrypted,
    workspaceDecrypted,
    conflicts,
  }
}

export async function getEffectiveDecryptedEnv(
  userId: string,
  workspaceId?: string
): Promise<Record<string, string>> {
  const { personalDecrypted, workspaceDecrypted } = await getPersonalAndWorkspaceEnv(
    userId,
    workspaceId
  )
  return { ...personalDecrypted, ...workspaceDecrypted }
}

/**
 * Ensure all environment variables can be decrypted.
 */
export async function ensureEnvVarsDecryptable(
  variables: Record<string, string>,
  options: { requestId?: string } = {}
): Promise<void> {
  const requestId = options.requestId
  for (const [key, encryptedValue] of Object.entries(variables)) {
    try {
      await decryptSecret(encryptedValue)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (requestId) {
        logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
      } else {
        logger.error(`Failed to decrypt environment variable "${key}"`, error)
      }
      throw new Error(`Failed to decrypt environment variable "${key}": ${message}`)
    }
  }
}

/**
 * Ensure all {{ENV_VAR}} references in block subblocks resolve to decryptable values.
 */
export async function ensureBlockEnvVarsResolvable(
  blocks: Record<string, BlockState>,
  variables: Record<string, string>,
  options: { requestId?: string } = {}
): Promise<void> {
  const requestId = options.requestId
  const envVarPattern = createEnvVarPattern()
  await Promise.all(
    Object.values(blocks).map(async (block) => {
      const subBlocks = block.subBlocks ?? {}
      await Promise.all(
        Object.values(subBlocks).map(async (subBlock) => {
          const value = subBlock.value
          if (
            typeof value !== 'string' ||
            !value.includes(REFERENCE.ENV_VAR_START) ||
            !value.includes(REFERENCE.ENV_VAR_END)
          ) {
            return
          }

          const matches = value.match(envVarPattern)
          if (!matches) {
            return
          }

          for (const match of matches) {
            const varName = match.slice(
              REFERENCE.ENV_VAR_START.length,
              -REFERENCE.ENV_VAR_END.length
            )
            const encryptedValue = variables[varName]
            if (!encryptedValue) {
              throw new Error(`Environment variable "${varName}" was not found`)
            }

            try {
              await decryptSecret(encryptedValue)
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error'
              if (requestId) {
                logger.error(
                  `[${requestId}] Error decrypting value for variable "${varName}"`,
                  error
                )
              } else {
                logger.error(`Error decrypting value for variable "${varName}"`, error)
              }
              throw new Error(`Failed to decrypt environment variable "${varName}": ${message}`)
            }
          }
        })
      )
    })
  )
}
