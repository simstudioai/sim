import { createForagerSearchTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'
import { PERSON_ROLE_SEARCH_RESULTS_OUTPUT } from '@/tools/forager/outputs'
import {
  personRoleSearchRequestSchema,
  personRoleSearchResponseSchema,
} from '@/tools/forager/schemas'

export const personRoleSearchTool = createForagerSearchTool({
  id: 'forager_person_role_search',
  name: 'Forager Person Role Search',
  description:
    'Search people and roles using Forager role, person, organization, funding, hiring, and company-event filters.',
  path: 'datastorage/person_role_search/',
  credits: 1,
  pricingBasis: FORAGER_PRICING_BASIS.personRoleSearch,
  requestSchema: personRoleSearchRequestSchema,
  responseSchema: personRoleSearchResponseSchema,
  resultsOutput: PERSON_ROLE_SEARCH_RESULTS_OUTPUT,
})
