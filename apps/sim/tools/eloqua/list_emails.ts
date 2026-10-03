import { createEloquaApplicationListTool } from '@/tools/eloqua/factories'

export const eloquaListEmailsTool = createEloquaApplicationListTool({
  id: 'eloqua_list_emails',
  name: 'List Oracle Eloqua Emails',
  description: 'Retrieve one bounded page of email assets from Oracle Eloqua.',
  path: '/api/rest/2.0/assets/emails',
  resource: 'email',
  extraParams: {
    includeAvailable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include available email assets',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include archived email assets',
    },
  },
  query: (params) => ({
    includeAvailable: params.includeAvailable,
    includeArchived: params.includeArchived,
  }),
})
