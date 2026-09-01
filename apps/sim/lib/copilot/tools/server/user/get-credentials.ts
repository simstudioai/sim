import { db } from '@sim/db'
import { account, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import { createPermissionError, verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { requireCopilotWorkspace } from '@/lib/copilot/tools/server/workspace-scope'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getAccessibleOAuthCredentials } from '@/lib/credentials/environment'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'
import {
  canonicalizeServiceProviderId,
  credentialProviderMatchesService,
  getAllOAuthServices,
} from '@/lib/oauth'
import { decryptAccountTokenColumnsBatch } from '@/lib/oauth/account-tokens'
import { intersectIntegrationAllowlists } from '@/lib/permission-groups/integration-allowlist'
import { checkWorkspaceAccess, type WorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { overlayVisibility } from '@/blocks/visibility/context'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

interface GetCredentialsParams {
  workflowId?: string
}

export const getCredentialsServerTool: BaseServerTool<GetCredentialsParams, any> = {
  name: 'get_credentials',
  async execute(params, context): Promise<any> {
    const logger = createLogger('GetCredentialsServerTool')

    if (!context?.userId) {
      logger.error('Unauthorized attempt to access credentials - no authenticated user context')
      throw new Error('Authentication required')
    }

    const authenticatedUserId = context.userId

    let workspaceId = context.workspaceId

    if (params?.workflowId) {
      const { hasAccess, workspaceId: wId } = await verifyWorkflowAccess(
        authenticatedUserId,
        params.workflowId
      )

      if (!hasAccess) {
        const errorMessage = createPermissionError('access credentials in')
        logger.error('Unauthorized attempt to access credentials', {
          workflowId: params.workflowId,
          authenticatedUserId,
        })
        throw new OrchestrationError('forbidden', errorMessage)
      }

      workspaceId = requireCopilotWorkspace(context, wId)
    }

    const userId = authenticatedUserId

    // Resolve workspace access once and thread it into both credential lookups
    // below; each would otherwise re-resolve the same workspace-admin status.
    const workspaceAccess: WorkspaceAccess | undefined = workspaceId
      ? await checkWorkspaceAccess(workspaceId, userId)
      : undefined

    logger.info('Fetching credentials for authenticated user', {
      userId,
      hasWorkflowId: !!params?.workflowId,
    })

    const [accountRows, userRecord] = await Promise.all([
      db
        .select({
          id: account.id,
          accountId: account.accountId,
          providerId: account.providerId,
          // account-token-access-allow: decrypted immediately below; needed for the display-name JWT decode
          idToken: account.idToken,
          updatedAt: account.updatedAt,
        })
        .from(account)
        .where(eq(account.userId, userId)),
      db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1),
    ])
    const accounts = await decryptAccountTokenColumnsBatch(accountRows)
    const userEmail = userRecord.length > 0 ? userRecord[0]?.email : null

    const permissionConfig = workspaceId ? await getUserPermissionConfig(userId, workspaceId) : null
    const configuredAllowedIntegrations = intersectIntegrationAllowlists(
      permissionConfig?.allowedIntegrations ?? null,
      getAllowedIntegrationsFromEnv()
    )
    const allowedIntegrationTypes = configuredAllowedIntegrations
      ? new Set(configuredAllowedIntegrations.map((type) => type.toLowerCase()))
      : null

    const serviceMetadata = getAllOAuthServices()
    const credentialVisibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes,
      blockVisibility: overlayVisibility(),
      oauthServices: serviceMetadata,
    })
    const allOAuthServices = serviceMetadata.filter((service) => service.authType === 'oauth')
    const visibleOAuthServices = allOAuthServices.filter(credentialVisibility.isOAuthServiceVisible)

    // Track connected provider IDs
    const connectedProviderIds = new Set<string>()

    const connectedCredentials: Array<{
      id: string
      name: string
      provider: string
      serviceName: string
      lastUsed: string
      isDefault: boolean
    }> = []

    for (const acc of accounts) {
      const providerId = acc.providerId
      const service = allOAuthServices.find((candidate) =>
        credentialProviderMatchesService(providerId, candidate)
      )
      if (!credentialVisibility.isCredentialVisible({ providerId, type: 'oauth' })) continue
      // `notConnectedServices` below compares against `service.providerId`, so an
      // alternate authorization server's id (`salesforce-sandbox`) has to fold
      // onto it or the service is listed as connected AND not connected.
      connectedProviderIds.add(canonicalizeServiceProviderId(providerId, service))

      const [baseProvider, featureType = 'default'] = providerId.split('-')
      let displayName = ''
      if (acc.idToken) {
        try {
          const decoded = decodeJwt<{ email?: string; name?: string }>(acc.idToken)
          displayName = decoded.email || decoded.name || ''
        } catch (error) {
          logger.warn('Failed to decode JWT id token', {
            error: toError(error).message,
          })
        }
      }
      if (!displayName && baseProvider === 'github') displayName = `${acc.accountId} (GitHub)`
      if (!displayName && userEmail) displayName = userEmail
      if (!displayName) displayName = `${acc.accountId} (${baseProvider})`

      // Find the service name for this provider ID
      const serviceName = service?.name ?? providerId

      connectedCredentials.push({
        id: acc.id,
        name: displayName,
        provider: providerId,
        serviceName,
        lastUsed: acc.updatedAt.toISOString(),
        isDefault: featureType === 'default',
      })
    }

    // Surface workspace-shared OAuth/service-account credentials the user can use,
    // including those they reach as a derived workspace admin (not just their own
    // personal account connections). Keyed by credential id so the agent references
    // the workspace credential, not a legacy account id.
    if (workspaceId) {
      const sharedCredentials = await getAccessibleOAuthCredentials(workspaceId, userId, {
        isWorkspaceAdmin: workspaceAccess?.canAdmin ?? false,
      })
      const seenCredentialIds = new Set(connectedCredentials.map((c) => c.id))
      for (const cred of sharedCredentials) {
        if (seenCredentialIds.has(cred.id)) continue
        if (
          !credentialVisibility.isCredentialVisible({
            providerId: cred.providerId,
            type: cred.type,
          })
        ) {
          continue
        }
        const service = allOAuthServices.find((candidate) =>
          credentialProviderMatchesService(cred.providerId, candidate)
        )
        connectedProviderIds.add(canonicalizeServiceProviderId(cred.providerId, service))
        const [, featureType = 'default'] = cred.providerId.split('-')
        connectedCredentials.push({
          id: cred.id,
          name: cred.displayName,
          provider: cred.providerId,
          serviceName: service?.name ?? cred.providerId,
          lastUsed: cred.updatedAt.toISOString(),
          isDefault: featureType === 'default',
        })
      }
    }

    // Build list of not connected services
    const notConnectedServices = visibleOAuthServices
      .filter((service) => !connectedProviderIds.has(service.providerId))
      .map((service) => ({
        providerId: service.providerId,
        name: service.name,
        description: service.description,
        baseProvider: service.baseProvider,
      }))

    // Fetch environment variables from both personal and workspace
    const envResult = await getPersonalAndWorkspaceEnv(
      userId,
      workspaceId,
      workspaceAccess ? { workspaceAccess } : undefined
    )

    // Get all unique variable names from both personal and workspace
    const personalVarNames = Object.keys(envResult.personalEncrypted)
    const workspaceVarNames = Object.keys(envResult.workspaceEncrypted)
    const allVarNames = [...new Set([...personalVarNames, ...workspaceVarNames])]

    logger.info('Fetched credentials', {
      userId,
      workspaceId,
      connectedCount: connectedCredentials.length,
      notConnectedCount: notConnectedServices.length,
      personalEnvVarCount: personalVarNames.length,
      workspaceEnvVarCount: workspaceVarNames.length,
      totalEnvVarCount: allVarNames.length,
      conflicts: envResult.conflicts,
    })

    return {
      oauth: {
        connected: {
          credentials: connectedCredentials,
          total: connectedCredentials.length,
        },
        notConnected: {
          services: notConnectedServices,
          total: notConnectedServices.length,
        },
      },
      environment: {
        variableNames: allVarNames,
        count: allVarNames.length,
        personalVariables: personalVarNames,
        workspaceVariables: workspaceVarNames,
        conflicts: envResult.conflicts,
      },
    }
  },
}
