import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import {
  type DeploymentAuthKind,
  type DeploymentAuthResource,
  deploymentAuthCookieName,
} from '@/lib/core/security/deployment'
import {
  type DeploymentAuthBody,
  type DeploymentAuthResult,
  validateDeploymentCredentials,
} from '@/lib/core/security/deployment-credentials'
import { getClientIp } from '@/lib/core/utils/request'

const logger = createLogger('DeploymentAuth')

/** Adapts authenticated session identity and HTTP credentials to the common deployment gate. */
export async function validateDeploymentAuth(
  requestId: string,
  resource: DeploymentAuthResource,
  request: NextRequest,
  parsedBody: DeploymentAuthBody | null | undefined,
  cookiePrefix: DeploymentAuthKind
): Promise<DeploymentAuthResult> {
  let sessionEmail: string | null | undefined
  let sessionPresent = false
  if (resource.authType === 'sso' && (request.method === 'GET' || parsedBody)) {
    try {
      const { getSession } = await import('@/lib/auth')
      const session = await getSession()
      sessionPresent = Boolean(session?.user)
      sessionEmail = session?.user?.email
    } catch (error) {
      logger.error(`[${requestId}] Error validating SSO:`, error)
      return { authorized: false, error: 'SSO authentication error' }
    }
  }
  return validateDeploymentCredentials(
    requestId,
    resource,
    {
      method: request.method,
      authToken: request.cookies.get(deploymentAuthCookieName(cookiePrefix, resource.id))?.value,
      clientIp: getClientIp(request),
      sessionPresent,
      sessionEmail,
    },
    parsedBody,
    cookiePrefix
  )
}
