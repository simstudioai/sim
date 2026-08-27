import { createForagerSearchTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'
import { ORGANIZATION_SEARCH_RESULTS_OUTPUT } from '@/tools/forager/outputs'
import {
  organizationSearchRequestSchema,
  organizationSearchResponseSchema,
} from '@/tools/forager/schemas'

export const organizationSearchTool = createForagerSearchTool({
  id: 'forager_organization_search',
  name: 'Forager Organization Search',
  description:
    'Search organizations with Forager firmographic, domain, LinkedIn, technology, funding, hiring, and company-event filters.',
  path: 'datastorage/organization_search/',
  credits: 1,
  pricingBasis: FORAGER_PRICING_BASIS.organizationSearch,
  requestSchema: organizationSearchRequestSchema,
  responseSchema: organizationSearchResponseSchema,
  resultsOutput: ORGANIZATION_SEARCH_RESULTS_OUTPUT,
})
