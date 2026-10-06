import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { restoreInboxRestriction } from '@/lib/mothership/inbox/admission'
import { checkInternalApiKey } from '@/lib/mothership/request/http'

/** Identity headers are assertions from the authenticated worker, never browser credentials. */
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
      if (!userId || !chatId || Boolean(workspaceId) === Boolean(organizationId))
        throw new InternalUnauthenticatedError()
      const executionRestriction = await restoreInboxRestriction({
        userId,
        workspaceId: workspaceId ?? undefined,
        organizationId: organizationId ?? undefined,
        chatId: chatId ?? undefined,
        streamId: request.headers.get('x-mothership-stream-id') ?? undefined,
      })
      if (organizationId) {
        if (!options.organization || !chatId) throw new InternalUnauthenticatedError()
        return createTrustedOrganizationCopilotPrincipal(
          { userId, organizationId, chatId, delegationId: `worker:${generateId()}` },
          { audience, ttlMs: 60_000 }
        )
      }
      return createTrustedCopilotPrincipal(
        {
          executionRestriction,
          userId,
          workspaceId: workspaceId!,
          ...(chatId ? { chatId } : {}),
          delegationId: `worker:${generateId()}`,
        },
        { audience, ttlMs: 60_000 }
      )
    },
  }
}
