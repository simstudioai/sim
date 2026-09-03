import { createEloquaApplicationItemTool } from '@/tools/eloqua/factories'
import { eloquaPositiveInteger } from '@/tools/eloqua/utils'

export const eloquaGetContactTool = createEloquaApplicationItemTool({
  id: 'eloqua_get_contact',
  name: 'Get Oracle Eloqua Contact',
  description: 'Retrieve one contact by ID from Oracle Eloqua.',
  path: (id) => `/api/rest/1.0/data/contact/${id}`,
  resource: 'contact',
  extraParams: {
    viewId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact view ID used to project the response',
    },
  },
  query: (params) => ({
    viewId: eloquaPositiveInteger(params.viewId, 'Eloqua contact view ID'),
  }),
})
