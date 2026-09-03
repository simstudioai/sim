import { createEloquaApplicationListTool } from '@/tools/eloqua/factories'

export const eloquaListContactsTool = createEloquaApplicationListTool({
  id: 'eloqua_list_contacts',
  name: 'List Oracle Eloqua Contacts',
  description: 'Retrieve one bounded page of contacts from Oracle Eloqua.',
  path: '/api/rest/1.0/data/contacts',
  resource: 'contact',
  allowNoContent: true,
  extraParams: {
    viewId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contact view ID used to filter and project the results',
    },
  },
  query: (params) => ({ viewId: params.viewId }),
})
