import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { acceptsRunGrant, checkRunGrant, rememberRunGrant } from '@/lib/mothership/auth/run-grant'
import { RUN_GRANT_HEADER } from '@/lib/mothership/generated/sim-transport'
import { checkInternalApiKey } from '@/lib/mothership/request/http'

/**
 * Identity headers are assertions from the authenticated worker, never browser credentials; the
 * run grant Sim issued with the turn proves them (`run-grant.ts`).
 */
export function internalCopilotAuth(audience: string, options: { organization?: boolean } = {}) {
  return {
    async authenticate(
      request: NextRequest
    ): Promise<DelegatedPrincipal | OrganizationDelegatedPrincipal> {
      if (!checkInternalApiKey(request).success) throw new InternalUnauthenticatedError()
      const userId = request.headers.get('x-mothership-user-id')
      const workspaceId = request.headers.get('x-mothership-workspace-id')
      const organizationId = request.headers.get('x-mothership-organization-id')
      const chatId = request.headers.get('x-mothership-chat-id')
      if (!userId || Boolean(workspaceId) === Boolean(organizationId))
        throw new InternalUnauthenticatedError()
      if (organizationId && (!options.organization || !chatId))
        throw new InternalUnauthenticatedError()
      const grant = await checkRunGrant(request.headers.get(RUN_GRANT_HEADER), {
        userId,
        ...(chatId ? { chatId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(organizationId ? { organizationId } : {}),
      })
      if (!acceptsRunGrant(grant)) throw new InternalUnauthenticatedError()
      const principal =
        organizationId && chatId
          ? createTrustedOrganizationCopilotPrincipal(
              { userId, organizationId, chatId, delegationId: `worker:${generateId()}` },
              { audience, ttlMs: 60_000 }
            )
          : createTrustedCopilotPrincipal(
              {
                userId,
                workspaceId: workspaceId!,
                ...(chatId ? { chatId } : {}),
                delegationId: `worker:${generateId()}`,
              },
              { audience, ttlMs: 60_000 }
            )
      rememberRunGrant(principal, grant)
      return principal
    },
  }
}
