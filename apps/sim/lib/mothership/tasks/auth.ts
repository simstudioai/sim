import type { DelegatedPrincipal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { checkInternalApiKey } from '@/lib/mothership/request/http'
import { TASK_DELEGATION_AUDIENCE } from '@/lib/mothership/tasks/application/context'

/** These identity headers are assertions from the authenticated worker, never browser credentials. */
export const internalTaskAuth = {
  async authenticate(request: NextRequest): Promise<DelegatedPrincipal> {
    if (!checkInternalApiKey(request).success) throw new InternalUnauthenticatedError()
    const userId = request.headers.get('x-mothership-user-id')
    const workspaceId = request.headers.get('x-mothership-workspace-id')
    if (!userId || !workspaceId) throw new InternalUnauthenticatedError()
    return createTrustedCopilotPrincipal(
      { userId, workspaceId, delegationId: `task:${generateId()}` },
      {
        audience: TASK_DELEGATION_AUDIENCE,
        ttlMs: 60_000,
      }
    )
  },
}
