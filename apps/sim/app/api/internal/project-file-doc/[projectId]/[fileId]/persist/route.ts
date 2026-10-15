import { projectFileDocPersistContract } from '@/lib/api/contracts/project-file-doc'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { realtimeProjectFileAuth } from '@/lib/auth/realtime-file-delegation'
import { persistProjectFileDoc } from '@/lib/projects/files/application/documents'

export const POST = defineInternalJsonRoute({
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
  parseOptions: { maxBodyBytes: 17 * 1024 * 1024 },
})
