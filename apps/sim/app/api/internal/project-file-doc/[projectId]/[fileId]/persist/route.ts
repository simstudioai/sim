import { NextResponse } from 'next/server'
import { projectFileDocPersistContract } from '@/lib/api/contracts/project-file-doc'
import { isOffAppHost } from '@/lib/api/mcp/host-routing'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { realtimeProjectFileAuth } from '@/lib/auth/realtime-file-delegation'
import { MAX_COLLAB_DOC_PERSIST_BODY_BYTES } from '@/lib/collab-doc/state'
import { persistProjectFileDoc } from '@/lib/projects/files/application/documents'

const persist = defineInternalJsonRoute({
  contract: projectFileDocPersistContract,
  operation: persistProjectFileDoc.operation,
  auth: realtimeProjectFileAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated realtime relay; socket frame admission bounds collaborative traffic',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...params,
    docState: new Uint8Array(Buffer.from(body.docState, 'base64')),
    expectedVersion: body.expectedVersion,
  }),
  useCase: persistProjectFileDoc,
  parseOptions: { maxBodyBytes: MAX_COLLAB_DOC_PERSIST_BODY_BYTES, bypassesProxy: true },
})

/** Excluded from the proxy matcher, so the route refuses the dedicated MCP host before auth itself. */
export const POST: typeof persist = (request, context) =>
  isOffAppHost(request)
    ? Promise.resolve(new NextResponse(null, { status: 404 }))
    : persist(request, context)
