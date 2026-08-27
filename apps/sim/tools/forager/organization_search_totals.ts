import { createForagerTotalsTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'
import {
  organizationSearchRequestSchema,
  searchTotalsResponseSchema,
} from '@/tools/forager/schemas'

export const organizationSearchTotalsTool = createForagerTotalsTool({
  id: 'forager_organization_search_totals',
  name: 'Forager Organization Search Totals',
  description:
    'Count organizations matching the complete documented Forager organization-search filter body.',
  path: 'datastorage/organization_search/totals/',
  credits: 1,
  pricingBasis: FORAGER_PRICING_BASIS.organizationSearchTotals,
  requestSchema: organizationSearchRequestSchema,
  responseSchema: searchTotalsResponseSchema,
})
