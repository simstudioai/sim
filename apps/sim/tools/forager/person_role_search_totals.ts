import { createForagerTotalsTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'
import {
  personRoleSearchRequestSchema,
  personRoleSearchTotalsResponseSchema,
} from '@/tools/forager/schemas'

export const personRoleSearchTotalsTool = createForagerTotalsTool({
  id: 'forager_person_role_search_totals',
  name: 'Forager Person Role Search Totals',
  description:
    'Count matching roles, distinct people, and distinct organizations for the complete documented Forager person-role search filter body.',
  path: 'datastorage/person_role_search/totals/',
  credits: 1,
  pricingBasis: FORAGER_PRICING_BASIS.personRoleSearchTotals,
  requestSchema: personRoleSearchRequestSchema,
  responseSchema: personRoleSearchTotalsResponseSchema,
  includeRoleTotals: true,
})
