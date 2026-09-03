import { createEloquaApplicationListTool } from '@/tools/eloqua/factories'

export const eloquaListContactListsTool = createEloquaApplicationListTool({
  id: 'eloqua_list_contact_lists',
  name: 'List Oracle Eloqua Contact Lists',
  description: 'Retrieve one bounded page of contact lists from Oracle Eloqua.',
  path: '/api/rest/1.0/assets/contact/lists',
  resource: 'contactList',
})
