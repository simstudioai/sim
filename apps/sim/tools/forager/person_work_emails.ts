import { createForagerContactTool } from '@/tools/forager/factories'
import { FORAGER_PRICING_BASIS } from '@/tools/forager/hosting'

export const personWorkEmailsTool = createForagerContactTool({
  id: 'forager_person_work_emails',
  name: 'Forager Person Work Emails',
  description:
    'Look up work-email records for a Forager person ID or LinkedIn public identifier, optionally requesting contact enrichment.',
  path: 'datastorage/person_contacts_lookup/work_emails/',
  outputKey: 'emails',
  credits: 5,
  pricingBasis: FORAGER_PRICING_BASIS.workEmail,
  includeContactsEnrichment: true,
})
