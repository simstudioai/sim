import { createEloquaApplicationItemTool } from '@/tools/eloqua/factories'

export const eloquaGetContactListTool = createEloquaApplicationItemTool({
  id: 'eloqua_get_contact_list',
  name: 'Get Oracle Eloqua Contact List',
  description: 'Retrieve one contact list by ID from Oracle Eloqua.',
  path: (id) => `/api/rest/1.0/assets/contact/list/${id}`,
  resource: 'contactList',
})
