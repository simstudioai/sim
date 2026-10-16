import type {
  DelegatedPrincipal,
  OrganizationDelegatedPrincipal,
  PersonalChatDelegatedPrincipal,
} from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
  createTrustedPersonalChatPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { RunControlRequest } from '@/lib/mothership/generated/run-control'
import { checkInternalApiKey } from '@/lib/mothership/request/http'

/** Identity headers are assertions from the authenticated worker, never browser credentials. */
export function internalCopilotAuth(
  audience: string,
  options: { organization?: boolean; personal?: boolean } = {}
) {
  return {
    async authenticate(
      request: NextRequest
    ): Promise<
      DelegatedPrincipal | OrganizationDelegatedPrincipal | PersonalChatDelegatedPrincipal
    > {
      if (!checkInternalApiKey(request).success) throw new InternalUnauthenticatedError()
      const userId = request.headers.get('x-mothership-user-id')
      const workspaceId = request.headers.get('x-mothership-workspace-id')
      const organizationId = request.headers.get('x-mothership-organization-id')
      const chatId = request.headers.get('x-mothership-chat-id')
      const executionStreamId = request.headers.get('x-mothership-execution-stream-id') ?? undefined
      if (
        executionStreamId !== undefined &&
        (!chatId || !RunControlRequest.shape.streamId.safeParse(executionStreamId).success)
      )
        throw new InternalUnauthenticatedError()
      if (!userId || (workspaceId && organizationId)) throw new InternalUnauthenticatedError()
      if (!workspaceId && !organizationId) {
        if (!options.personal || !chatId) throw new InternalUnauthenticatedError()
        return createTrustedPersonalChatPrincipal(
          { userId, chatId, executionStreamId, delegationId: `worker:${generateId()}` },
          { audience, ttlMs: 60_000 }
        )
      }
      if (organizationId) {
        if (!options.organization || !chatId) throw new InternalUnauthenticatedError()
        return createTrustedOrganizationCopilotPrincipal(
          {
            userId,
            organizationId,
            chatId,
            executionStreamId,
            delegationId: `worker:${generateId()}`,
          },
          { audience, ttlMs: 60_000 }
        )
      }
      return createTrustedCopilotPrincipal(
        {
          userId,
          executionStreamId,
          workspaceId: workspaceId!,
          ...(chatId ? { chatId } : {}),
          delegationId: `worker:${generateId()}`,
        },
        { audience, ttlMs: 60_000 }
      )
    },
  }
}
