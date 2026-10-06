import { createEloquaBulkListTool } from '@/tools/eloqua/factories'

export const eloquaListContactFieldsTool = createEloquaBulkListTool({
  id: 'eloqua_list_contact_fields',
  name: 'List Oracle Eloqua Contact Fields',
  description: 'Retrieve one bounded page of Bulk API contact field definitions.',
  path: '/api/bulk/2.0/contacts/fields',
  itemKind: 'contactField',
})
