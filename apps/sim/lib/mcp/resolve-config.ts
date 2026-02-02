/**
 * Server-only MCP config resolution utilities.
 * This file contains functions that require server-side dependencies (database access).
 * Do NOT import this file in client components.
 */

import { createLogger } from '@sim/logger'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import type { McpServerConfig } from '@/lib/mcp/types'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

const logger = createLogger('McpResolveConfig')

export interface ResolveMcpConfigOptions {
  /** If true, throws an error when env vars are missing. Default: true */
  strict?: boolean
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
): Promise<{ config: McpServerConfig; missingVars: string[] }> {
  const { strict = true } = options
  const allMissingVars: string[] = []

  let envVars: Record<string, string> = {}
  try {
    envVars = await getEffectiveDecryptedEnv(userId, workspaceId)
  } catch (error) {
    logger.error('Failed to fetch environment variables for MCP config:', error)
    return { config, missingVars: [] }
  }

  const resolveValue = (value: string): string => {
    const missingVars: string[] = []
    const resolved = resolveEnvVarReferences(value, envVars, {
      missingKeys: missingVars,
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

  // Handle missing vars based on strict mode
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

  return { config: resolvedConfig, missingVars: allMissingVars }
}
