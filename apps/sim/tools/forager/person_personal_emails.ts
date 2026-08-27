import { createForagerContactTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'

export const personPersonalEmailsTool = createForagerContactTool({
  id: 'forager_person_personal_emails',
  name: 'Forager Person Personal Emails',
  description:
    'Look up personal email records for a Forager person ID or LinkedIn public identifier. A documented empty success response returns an empty array.',
  path: 'datastorage/person_contacts_lookup/personal_emails/',
  outputKey: 'emails',
  credits: 5,
  pricingBasis: FORAGER_PRICING_BASIS.personalEmail,
  allowEmptyResponse: true,
})
