import { createEloquaApplicationItemTool } from '@/tools/eloqua/factories'
import { eloquaPositiveInteger } from '@/tools/eloqua/utils'

export const eloquaGetAccountTool = createEloquaApplicationItemTool({
  id: 'eloqua_get_account',
  name: 'Get Oracle Eloqua Account',
  description: 'Retrieve one account by ID from Oracle Eloqua.',
  path: (id) => `/api/rest/1.0/data/account/${id}`,
  resource: 'account',
  extraParams: {
    viewId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account view ID used to project the response',
    },
  },
  query: (params) => ({
    viewId: eloquaPositiveInteger(params.viewId, 'Eloqua account view ID'),
  }),
})
