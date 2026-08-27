import { createForagerTotalsTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'
import { jobSearchRequestSchema, searchTotalsResponseSchema } from '@/tools/forager/schemas'

export const jobSearchTotalsTool = createForagerTotalsTool({
  id: 'forager_job_search_totals',
  name: 'Forager Job Search Totals',
  description: 'Count Forager job posts matching the complete documented job-search filter body.',
  path: 'datastorage/job_search/totals/',
  credits: 2,
  pricingBasis: FORAGER_PRICING_BASIS.jobSearchTotals,
  requestSchema: jobSearchRequestSchema,
  responseSchema: searchTotalsResponseSchema,
})
