import { createEloquaApplicationListTool } from '@/tools/eloqua/factories'
import { eloquaPositiveInteger } from '@/tools/eloqua/utils'

export const eloquaListAccountsTool = createEloquaApplicationListTool({
  id: 'eloqua_list_accounts',
  name: 'List Oracle Eloqua Accounts',
  description: 'Retrieve one bounded page of accounts from Oracle Eloqua.',
  path: '/api/rest/1.0/data/accounts',
  resource: 'account',
  allowNoContent: true,
  extraParams: {
    viewId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account view ID used to filter and project the results',
    },
    ownedByUserId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return accounts owned by this Eloqua user ID',
    },
  },
  query: (params) => ({
    viewId: eloquaPositiveInteger(params.viewId, 'Eloqua account view ID'),
    ownedByUserId: eloquaPositiveInteger(params.ownedByUserId, 'Eloqua account owner user ID'),
  }),
})
