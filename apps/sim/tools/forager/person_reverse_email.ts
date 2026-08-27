import { createForagerReverseEmailTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'

export const personReverseEmailTool = createForagerReverseEmailTool({
  id: 'forager_person_reverse_email',
  name: 'Forager Person Reverse Email',
  description: 'Resolve a personal email address to a complete Forager person profile.',
  path: 'datastorage/person_detail_reverse_lookup/by_email/',
  credits: 5,
  pricingBasis: FORAGER_PRICING_BASIS.reverseEmail,
})
