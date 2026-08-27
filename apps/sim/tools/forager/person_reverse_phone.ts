import { createForagerReversePhoneTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'

export const personReversePhoneTool = createForagerReversePhoneTool({
  id: 'forager_person_reverse_phone',
  name: 'Forager Person Reverse Phone',
  description: 'Resolve a phone number to a complete Forager person profile.',
  path: 'datastorage/person_detail_reverse_lookup/by_phone_number/',
  credits: 15,
  pricingBasis: FORAGER_PRICING_BASIS.reversePhone,
})
