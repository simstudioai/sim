import { projectFileDocSeedContract } from '@/lib/api/contracts/project-file-doc'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { realtimeProjectFileAuth } from '@/lib/auth/realtime-file-delegation'
import { buildProjectFileDocSeed } from '@/lib/projects/files/application/documents'

export const POST = defineInternalJsonRoute({
  contract: projectFileDocSeedContract,
  operation: buildProjectFileDocSeed.operation,
  auth: realtimeProjectFileAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated realtime relay; socket frame admission bounds collaborative traffic',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: buildProjectFileDocSeed,
  present: (result) => ({
    update: Buffer.from(result.update).toString('base64'),
    version: result.version,
  }),
})
