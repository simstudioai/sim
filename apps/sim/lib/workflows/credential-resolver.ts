import { createLogger } from '@/lib/logs/console/logger'
import { getProviderIdFromServiceId, getServiceIdFromScopes } from '@/lib/oauth/oauth'
import { getBlock } from '@/blocks/index'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CredentialResolver')

interface Credential {
  id: string
  isDefault: boolean
  scopes?: string[]
}

/**
 * Resolves and auto-selects credentials for blocks before YAML generation
 * This ensures that credential fields are populated with appropriate values
 */
export async function resolveCredentialsForWorkflow(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>>,
  userId?: string
): Promise<Record<string, Record<string, any>>> {
  const resolvedValues = { ...subBlockValues }

  logger.info('Starting credential resolution for workflow', {
    userId,
    blockCount: Object.keys(blocks).length,
  })

  try {
    // Process each block
    for (const [blockId, blockState] of Object.entries(blocks)) {
      const blockConfig = getBlock(blockState.type)
      if (!blockConfig) {
        logger.debug(`No config found for block type: ${blockState.type}`)
        continue
      }

      // Initialize block values if not present
      if (!resolvedValues[blockId]) {
        resolvedValues[blockId] = {}
      }

      // Process each subBlock configuration
      for (const subBlockConfig of blockConfig.subBlocks) {
        // Only process oauth-input type subblocks (credential selectors)
        if (subBlockConfig.type !== 'oauth-input') continue

        const subBlockId = subBlockConfig.id
        const existingValue = resolvedValues[blockId][subBlockId]

        logger.debug(`Checking credential for ${blockId}.${subBlockId}`, {
          blockType: blockState.type,
          provider: subBlockConfig.provider,
          hasExistingValue: !!existingValue,
          existingValue,
        })

        // Skip if already has a valid value
        if (existingValue && typeof existingValue === 'string' && existingValue.trim()) {
          logger.debug(`Skipping - already has credential: ${existingValue}`)
          continue
        }

        // Resolve credential for this subblock
        const credentialId = await resolveCredentialForSubBlock(subBlockConfig, blockState, userId)

        if (credentialId) {
          resolvedValues[blockId][subBlockId] = credentialId
          logger.info(`Auto-selected credential for ${blockId}.${subBlockId}`, {
            blockType: blockState.type,
            provider: subBlockConfig.provider,
            credentialId,
          })
        } else {
          logger.info(`No credential auto-selected for ${blockId}.${subBlockId}`, {
            blockType: blockState.type,
            provider: subBlockConfig.provider,
          })
        }
      }
    }

    logger.info('Credential resolution completed', {
      resolvedCount: Object.values(resolvedValues).reduce(
        (count, blockValues) => count + Object.keys(blockValues).length,
        0
      ),
    })

    return resolvedValues
  } catch (error) {
    logger.error('Error resolving credentials for workflow:', error)
    // Return original values on error
    return subBlockValues
  }
}

/**
 * Resolves a single credential for a subblock
 */
async function resolveCredentialForSubBlock(
  subBlockConfig: SubBlockConfig & {
    provider?: string
    requiredScopes?: string[]
    serviceId?: string
  },
  blockState: BlockState,
  userId?: string
): Promise<string | null> {
  try {
    const provider = subBlockConfig.provider
    const requiredScopes = subBlockConfig.requiredScopes || []
    const serviceId = subBlockConfig.serviceId

    logger.debug('Resolving credential for subblock', {
      blockType: blockState.type,
      provider,
      serviceId,
      requiredScopes,
      userId,
    })

    if (!provider) {
      logger.debug('No provider specified, skipping credential resolution')
      return null
    }

    // Derive service and provider IDs
    const effectiveServiceId = serviceId || getServiceIdFromScopes(provider as any, requiredScopes)
    const effectiveProviderId = getProviderIdFromServiceId(effectiveServiceId)

    logger.debug('Derived provider info', {
      effectiveServiceId,
      effectiveProviderId,
    })

    // Fetch credentials from the API
    // Note: This assumes we're running in a server context with access to fetch
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const credentialsUrl = `${baseUrl}/api/auth/oauth/credentials?provider=${effectiveProviderId}`

    logger.debug('Fetching credentials', { url: credentialsUrl })

    const response = await fetch(credentialsUrl, {
      headers: userId ? { 'x-user-id': userId } : {},
    })

    if (!response.ok) {
      logger.error(`Failed to fetch credentials for provider ${effectiveProviderId}`, {
        status: response.status,
        statusText: response.statusText,
      })
      return null
    }

    const data = await response.json()
    const credentials: Credential[] = data.credentials || []

    logger.info(`Found ${credentials.length} credential(s) for provider ${effectiveProviderId}`, {
      credentials: credentials.map((c) => ({
        id: c.id,
        isDefault: c.isDefault,
      })),
    })

    if (credentials.length === 0) {
      return null
    }

    // Auto-selection logic (same as credential-selector component):
    // 1. Look for default credential
    // 2. If only one credential, select it
    const defaultCred = credentials.find((cred) => cred.isDefault)
    if (defaultCred) {
      logger.info(`Selected default credential: ${defaultCred.id}`)
      return defaultCred.id
    }

    if (credentials.length === 1) {
      logger.info(`Selected only credential: ${credentials[0].id}`)
      return credentials[0].id
    }

    // No clear selection, return null
    logger.info('Multiple credentials available, none selected (user must choose)')
    return null
  } catch (error) {
    logger.error('Error resolving credential for subblock:', error)
    return null
  }
}

/**
 * Checks if a workflow needs credential resolution
 * Returns true if any block has credential-type subblocks without values
 */
export function needsCredentialResolution(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, any>>
): boolean {
  for (const [blockId, blockState] of Object.entries(blocks)) {
    const blockConfig = getBlock(blockState.type)
    if (!blockConfig) continue

    for (const subBlockConfig of blockConfig.subBlocks) {
      if (subBlockConfig.type !== 'oauth-input') continue

      const value = subBlockValues[blockId]?.[subBlockConfig.id]
      if (!value || (typeof value === 'string' && !value.trim())) {
        return true
      }
    }
  }

  return false
}
