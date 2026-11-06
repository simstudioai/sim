import type { ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { FILE_DOC_INTERNAL_HEADERS } from '@sim/realtime-protocol/file-doc'
import { generateId } from '@sim/utils/id'
import {
  type InternalAuthPolicy,
  InternalUnauthenticatedError,
} from '@/lib/api/server/routes/internal-json-route'
import { checkInternalApiKey } from '@/lib/mothership/request/http'
import { PROJECT_FILE_DELEGATION_TTL_MS } from '@/lib/projects/files/application/operations'

/** Internal relay requests carry the authenticated socket actor, bounded to exactly one Project file. */
export const realtimeProjectFileAuth: InternalAuthPolicy<ResourceDelegatedPrincipal> = {
  async authenticate(request, params) {
    if (!checkInternalApiKey(request).success) throw new InternalUnauthenticatedError()
    const subjectUserId = request.headers.get(FILE_DOC_INTERNAL_HEADERS.userId)
    const connectionId = request.headers.get(FILE_DOC_INTERNAL_HEADERS.connectionId)
    const projectId = params.projectId
    const fileId = params.fileId
    if (
      !subjectUserId?.trim() ||
      !connectionId?.trim() ||
      typeof projectId !== 'string' ||
      !projectId ||
      typeof fileId !== 'string' ||
      !fileId
    ) {
      throw new InternalUnauthenticatedError()
    }
    const now = Date.now()
    return {
      kind: 'resource_delegated',
      serviceId: 'realtime',
      subjectUserId,
      invocation: { kind: 'realtime', connectionId },
      scope: { kind: 'entity', entityType: 'project', entityId: projectId, fileId },
      audience: 'sim:project-files',
      delegationId: generateId(),
      issuedAt: new Date(now),
      expiresAt: new Date(now + PROJECT_FILE_DELEGATION_TTL_MS),
    }
  },
}
