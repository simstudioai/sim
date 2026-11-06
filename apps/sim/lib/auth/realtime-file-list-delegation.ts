import type { ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { FILE_DOC_INTERNAL_HEADERS } from '@sim/realtime-protocol/file-doc'
import { generateId } from '@sim/utils/id'
import {
  type InternalAuthPolicy,
  InternalUnauthenticatedError,
} from '@/lib/api/server/routes/internal-json-route'
import { checkInternalApiKey } from '@/lib/mothership/request/http'
import { PROJECT_FILE_DELEGATION_TTL_MS } from '@/lib/projects/files/application/operations'

/** The relay attests the socket actor and connection, bounded to observing one Project collection. */
export const realtimeProjectFileListAuth: InternalAuthPolicy<ResourceDelegatedPrincipal> = {
  async authenticate(request, params) {
    if (!checkInternalApiKey(request).success) throw new InternalUnauthenticatedError()
    const subjectUserId = request.headers.get(FILE_DOC_INTERNAL_HEADERS.userId)
    const connectionId = request.headers.get(FILE_DOC_INTERNAL_HEADERS.connectionId)
    const projectId = params.projectId
    if (
      !subjectUserId?.trim() ||
      !connectionId?.trim() ||
      typeof projectId !== 'string' ||
      !projectId
    ) {
      throw new InternalUnauthenticatedError()
    }
    const now = Date.now()
    return {
      kind: 'resource_delegated',
      serviceId: 'realtime',
      subjectUserId,
      invocation: { kind: 'realtime', connectionId },
      scope: { kind: 'file_collection_observation', entityType: 'project', entityId: projectId },
      audience: 'sim:file-list-observation',
      delegationId: generateId(),
      issuedAt: new Date(now),
      expiresAt: new Date(now + PROJECT_FILE_DELEGATION_TTL_MS),
    }
  },
}
