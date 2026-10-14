import { projectFileDocPersistContract } from '@/lib/api/contracts/project-file-doc'
import { isOffAppHost } from '@/lib/api/mcp/host-routing'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { realtimeProjectFileAuth } from '@/lib/auth/realtime-file-delegation'
import { MAX_COLLAB_DOC_STATE_BYTES } from '@/lib/collab-doc/state'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { persistProjectFileDoc } from '@/lib/projects/files/application/documents'

/** A base64-encoded maximum snapshot plus 1 MiB for its JSON envelope (17 MiB). */
const PERSIST_MAX_BODY_BYTES = Math.ceil(MAX_COLLAB_DOC_STATE_BYTES / 3) * 4 + 1024 * 1024

export const POST = defineInternalJsonRoute({
  contract: projectFileDocPersistContract,
  operation: persistProjectFileDoc.operation,
  auth: realtimeProjectFileAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated realtime relay; socket frame admission bounds collaborative traffic',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  /** Excluded from the proxy matcher, so the route refuses the dedicated MCP host itself. */
  beforeParse: ({ request }) => {
    if (isOffAppHost(request)) throw new OrchestrationError('not_found', 'Not found')
  },
  mapInput: ({ params, body }) => ({
    ...params,
    docState: new Uint8Array(Buffer.from(body.docState, 'base64')),
    expectedVersion: body.expectedVersion,
  }),
  useCase: persistProjectFileDoc,
  parseOptions: { maxBodyBytes: PERSIST_MAX_BODY_BYTES, bypassesProxy: true },
})
