import { createForagerContactTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'

export const personPhoneNumbersTool = createForagerContactTool({
  id: 'forager_person_phone_numbers',
  name: 'Forager Person Phone Numbers',
  description:
    'Look up phone-number records for a Forager person ID or LinkedIn public identifier.',
  path: 'datastorage/person_contacts_lookup/phone_numbers/',
  outputKey: 'phoneNumbers',
  credits: 15,
  pricingBasis: FORAGER_PRICING_BASIS.phoneNumber,
})
