import { db } from '@sim/db'
import { account, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { createPermissionError, verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { generateRequestId } from '@/lib/core/utils/request'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { getAllOAuthServices } from '@/lib/oauth'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'

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
      accessToken: string | null
    }> = []
    const requestId = generateRequestId()

    for (const acc of accounts) {
      const providerId = acc.providerId
      connectedProviderIds.add(providerId)

      const [baseProvider, featureType = 'default'] = providerId.split('-')
      let displayName = ''
      if (acc.idToken) {
        try {
          const decoded = jwtDecode<{ email?: string; name?: string }>(acc.idToken)
          displayName = decoded.email || decoded.name || ''
        } catch {}
      }
      if (!displayName && baseProvider === 'github') displayName = `${acc.accountId} (GitHub)`
      if (!displayName && userEmail) displayName = userEmail
      if (!displayName) displayName = `${acc.accountId} (${baseProvider})`

      // Find the service name for this provider ID
      const service = allOAuthServices.find((s) => s.providerId === providerId)
      const serviceName = service?.name ?? providerId

      let accessToken: string | null = acc.accessToken ?? null
      try {
        const { accessToken: refreshedToken } = await refreshTokenIfNeeded(
          requestId,
          acc as any,
          acc.id
        )
        accessToken = refreshedToken || accessToken
      } catch {}
      connectedCredentials.push({
        id: acc.id,
        name: displayName,
        provider: providerId,
        serviceName,
        lastUsed: acc.updatedAt.toISOString(),
        isDefault: featureType === 'default',
        accessToken,
      })
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
    const envResult = await getPersonalAndWorkspaceEnv(userId, workspaceId)

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
