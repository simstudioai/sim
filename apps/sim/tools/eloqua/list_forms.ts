import { createEloquaApplicationListTool } from '@/tools/eloqua/factories'

export const eloquaListFormsTool = createEloquaApplicationListTool({
  id: 'eloqua_list_forms',
  name: 'List Oracle Eloqua Forms',
  description: 'Retrieve one bounded page of form assets from Oracle Eloqua.',
  path: '/api/rest/2.0/assets/forms',
  resource: 'form',
  extraParams: {
    includeAvailable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include available form assets',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include archived form assets',
    },
  },
  query: (params) => ({
    includeAvailable: params.includeAvailable,
    includeArchived: params.includeArchived,
  }),
})
