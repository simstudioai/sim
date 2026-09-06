import type { DelegatedPrincipal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { checkInternalApiKey } from '@/lib/mothership/request/http'

/** Identity headers are assertions from the authenticated worker, never browser credentials. */
export function internalCopilotAuth(audience: string) {
  return {
    async authenticate(request: NextRequest): Promise<DelegatedPrincipal> {
      if (!checkInternalApiKey(request).success) throw new InternalUnauthenticatedError()
      const userId = request.headers.get('x-mothership-user-id')
      const workspaceId = request.headers.get('x-mothership-workspace-id')
      if (!userId || !workspaceId) throw new InternalUnauthenticatedError()
      return createTrustedCopilotPrincipal(
        { userId, workspaceId, delegationId: `worker:${generateId()}` },
        { audience, ttlMs: 60_000 }
      )
    },
  }
}
