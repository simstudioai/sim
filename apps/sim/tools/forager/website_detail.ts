import { createForagerWebsiteTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'

export const websiteDetailTool = createForagerWebsiteTool({
  id: 'forager_website_detail',
  name: 'Forager Website Detail',
  description:
    'Look up a website by domain, Forager organization ID, or LinkedIn company identifier and return ranks, traffic, and technologies.',
  path: 'datastorage/website_detail_lookup/',
  credits: 1,
  pricingBasis: FORAGER_PRICING_BASIS.websiteDetail,
})
