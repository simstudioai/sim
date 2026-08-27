import { createForagerPersonDetailTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'

export const personDetailTool = createForagerPersonDetailTool({
  id: 'forager_person_detail',
  name: 'Forager Person Detail',
  description:
    'Retrieve a complete Forager person profile by person ID or LinkedIn public identifier, including roles, education, skills, and authored work.',
  path: 'datastorage/person_detail_lookup/',
  credits: 1,
  pricingBasis: FORAGER_PRICING_BASIS.personDetail,
})
