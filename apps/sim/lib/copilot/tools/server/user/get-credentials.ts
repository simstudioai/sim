import { db } from '@sim/db'
import { account, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import { createPermissionError, verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getAccessibleOAuthCredentials } from '@/lib/credentials/environment'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { getAllOAuthServices } from '@/lib/oauth'
import { checkWorkspaceAccess, type WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

interface GetCredentialsParams {
  workflowId?: string
}

export const getCredentialsServerTool: BaseServerTool<GetCredentialsParams, any> = {
  name: 'get_credentials',
  async execute(params: GetCredentialsParams, context?: { userId: string }): Promise<any> {
    const logger = createLogger('GetCredentialsServerTool')

    if (!context?.userId) {
      logger.error('Unauthorized attempt to access credentials - no authenticated user context')
      throw new Error('Authentication required')
    }

    const authenticatedUserId = context.userId

    let workspaceId: string | undefined

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
        throw new Error(errorMessage)
      }

      workspaceId = wId
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

    // Fetch OAuth credentials
    const accounts = await db.select().from(account).where(eq(account.userId, userId))
    const userRecord = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const userEmail = userRecord.length > 0 ? userRecord[0]?.email : null

    // Get all available OAuth services
    const allOAuthServices = getAllOAuthServices()

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
      connectedProviderIds.add(providerId)

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
      const service = allOAuthServices.find((s) => s.providerId === providerId)
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
        connectedProviderIds.add(cred.providerId)
        const [, featureType = 'default'] = cred.providerId.split('-')
        connectedCredentials.push({
          id: cred.id,
          name: cred.displayName,
          provider: cred.providerId,
          serviceName:
            allOAuthServices.find((s) => s.providerId === cred.providerId)?.name ?? cred.providerId,
          lastUsed: cred.updatedAt.toISOString(),
          isDefault: featureType === 'default',
        })
      }
    }

    // Build list of not connected services
    const notConnectedServices = allOAuthServices
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
