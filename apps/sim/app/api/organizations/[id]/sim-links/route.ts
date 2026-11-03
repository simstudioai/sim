import { createSimLinkContract, listSimLinksContract } from '@/lib/api/contracts/sim-links'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentSimLink } from '@/lib/api/server/sim-link-presenters'
import { createSimLink, listSimLinks } from '@/lib/sim-links/application/use-cases'

const policy = {
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.user({ bucketName: 'sim-links' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
}

export const GET = defineInternalJsonRoute({
  ...policy,
  contract: listSimLinksContract,
  operation: listSimLinks.operation,
  useCase: listSimLinks,
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
  present: ({ links, nextCursor }) => ({ links: links.map(presentSimLink), nextCursor }),
})

export const POST = defineInternalJsonRoute({
  ...policy,
  contract: createSimLinkContract,
  operation: createSimLink.operation,
  useCase: createSimLink,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  present: (link) => ({ link: presentSimLink(link) }),
})
