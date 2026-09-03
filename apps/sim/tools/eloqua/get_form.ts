import { createEloquaApplicationItemTool } from '@/tools/eloqua/factories'

export const eloquaGetFormTool = createEloquaApplicationItemTool({
  id: 'eloqua_get_form',
  name: 'Get Oracle Eloqua Form',
  description: 'Retrieve one form asset by ID from Oracle Eloqua.',
  path: (id) => `/api/rest/2.0/assets/form/${id}`,
  resource: 'form',
})
