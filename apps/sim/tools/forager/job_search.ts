import { createForagerSearchTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'
import { JOB_SEARCH_RESULTS_OUTPUT } from '@/tools/forager/outputs'
import { jobSearchRequestSchema, jobSearchResponseSchema } from '@/tools/forager/schemas'

export const jobSearchTool = createForagerSearchTool({
  id: 'forager_job_search',
  name: 'Forager Job Search',
  description:
    'Search Forager job posts by source, dates, organization IDs, Boolean title or description, remote and active status, and location IDs.',
  path: 'datastorage/job_search/',
  credits: 2,
  pricingBasis: FORAGER_PRICING_BASIS.jobSearch,
  requestSchema: jobSearchRequestSchema,
  responseSchema: jobSearchResponseSchema,
  resultsOutput: JOB_SEARCH_RESULTS_OUTPUT,
})
