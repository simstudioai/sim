import { deleteSimLinkContract, updateSimLinkContract } from '@/lib/api/contracts/sim-links'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentSimLink } from '@/lib/api/server/sim-link-presenters'
import { deleteSimLink, updateSimLink } from '@/lib/sim-links/application/use-cases'

const policy = {
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'sim-links' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
}

export const PUT = defineInternalJsonRoute({
  ...policy,
  contract: updateSimLinkContract,
  operation: updateSimLink.operation,
  useCase: updateSimLink,
  mapInput: ({ params, body }) => ({ organizationId: params.id, linkId: params.linkId, ...body }),
  present: (link) => ({ link: presentSimLink(link) }),
})

export const DELETE = defineInternalJsonRoute({
  ...policy,
  contract: deleteSimLinkContract,
  operation: deleteSimLink.operation,
  useCase: deleteSimLink,
  mapInput: ({ params }) => ({ organizationId: params.id, linkId: params.linkId }),
  present: () => ({ success: true as const }),
})
