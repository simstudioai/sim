/**
 * Server-only MCP config resolution utilities.
 * This file contains functions that require server-side dependencies (database access).
 * Do NOT import this file in client components.
 */

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type EnvironmentResolutionSnapshot,
  getEffectiveEnvironmentSnapshot,
} from '@/lib/environment/utils'
import type { McpServerConfig } from '@/lib/mcp/types'
import { recordSecretUsage } from '@/lib/secrets/usage/record'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import {
  createIncompleteResolvedSecretTraceRegistry,
  createResolvedSecretTraceRegistry,
  type ResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('McpResolveConfig')

export interface ResolveMcpConfigOptions {
  /** If true, throws an error when env vars are missing. Default: true */
  strict?: boolean
  onResolvedSecretTraceProvenance?: (provenance: ResolvedSecretTraceProvenanceV1) => void
}

/**
 * Resolve environment variables in MCP server config (url, headers).
 * Shared utility used by both MCP service and test-connection endpoint.
 *
 * @param config - MCP server config with potential {{ENV_VAR}} patterns
 * @param userId - User ID to fetch environment variables for
 * @param workspaceId - Workspace ID for workspace-specific env vars
 * @param options - Resolution options (strict mode throws on missing vars)
 * @returns Resolved config with env vars replaced
 */
export async function resolveMcpConfigEnvVars(
  config: McpServerConfig,
  userId: string,
  workspaceId?: string,
  options: ResolveMcpConfigOptions = {}
): Promise<{
  config: McpServerConfig
  missingVars: string[]
  resolvedSecretTraceProvenance: ResolvedSecretTraceProvenanceV1
}> {
  const { strict = true } = options
  const allMissingVars: string[] = []
  const scope = { userId, ...(workspaceId ? { workspaceId } : {}) }

  let env: EnvironmentResolutionSnapshot
  try {
    env = await getEffectiveEnvironmentSnapshot(userId, workspaceId)
  } catch (error) {
    logger.error('Failed to fetch environment variables for MCP config:', error)
    const resolvedSecretTraceRegistry = createIncompleteResolvedSecretTraceRegistry(scope)
    const provenance = resolvedSecretTraceRegistry.exportProvenance()
    options.onResolvedSecretTraceProvenance?.(provenance)
    return {
      config,
      missingVars: [],
      resolvedSecretTraceProvenance: provenance,
    }
  }
  const envVars = { ...env.personalDecrypted, ...env.workspaceDecrypted }

  let resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
  try {
    resolvedSecretTraceRegistry = await createResolvedSecretTraceRegistry({
      personalEncrypted: env.personalEncrypted,
      workspaceEncrypted: env.workspaceEncrypted,
      personalDecrypted: env.personalDecrypted,
      workspaceDecrypted: env.workspaceDecrypted,
      decryptionFailures: env.decryptionFailures,
      personalOwners: env.personalOwners,
      workspaceUnredactedKeys: env.workspaceUnredactedKeys,
      scope,
    })
  } catch (error) {
    logger.warn('Failed to build MCP trace secret catalog; provenance will be incomplete', {
      error: getErrorMessage(error),
    })
    resolvedSecretTraceRegistry = createIncompleteResolvedSecretTraceRegistry(scope)
  }

  const resolveValue = (value: string): string => {
    const missingVars: string[] = []
    const resolved = resolveEnvVarReferences(value, envVars, {
      missingKeys: missingVars,
      onResolved: (name, resolvedValue) => {
        resolvedSecretTraceRegistry.recordResolved(name, resolvedValue)
      },
    }) as string
    allMissingVars.push(...missingVars)
    return resolved
  }

  const resolvedConfig = { ...config }

  if (resolvedConfig.url) {
    resolvedConfig.url = resolveValue(resolvedConfig.url)
  }

  if (resolvedConfig.headers) {
    const resolvedHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(resolvedConfig.headers)) {
      resolvedHeaders[key] = resolveValue(value)
    }
    resolvedConfig.headers = resolvedHeaders
  }

  const resolvedSecretTraceProvenance = resolvedSecretTraceRegistry.exportProvenance()
  options.onResolvedSecretTraceProvenance?.(resolvedSecretTraceProvenance)

  if (allMissingVars.length > 0) {
    const uniqueMissing = Array.from(new Set(allMissingVars))

    if (strict) {
      throw new Error(
        `Missing required environment variable${uniqueMissing.length > 1 ? 's' : ''}: ${uniqueMissing.join(', ')}. ` +
          `Please set ${uniqueMissing.length > 1 ? 'these variables' : 'this variable'} in your workspace or personal environment settings.`
      )
    }
    uniqueMissing.forEach((envKey) => {
      logger.warn(`Environment variable "${envKey}" not found in MCP config`)
    })
  }

  /**
   * MCP server config resolves outside any workflow run, so no execution completion will
   * record it. Without this a secret used only to reach an MCP server reads as never used.
   */
  if (workspaceId) {
    recordSecretUsage(resolvedSecretTraceRegistry.getResolvedSecretUsage(), {
      workspaceId,
      source: 'mcp',
      actorUserId: userId,
      trigger: 'mcp',
    })
  }

  return {
    config: resolvedConfig,
    missingVars: allMissingVars,
    resolvedSecretTraceProvenance,
  }
}
