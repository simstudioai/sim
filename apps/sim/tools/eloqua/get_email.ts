import { createEloquaApplicationItemTool } from '@/tools/eloqua/factories'

export const eloquaGetEmailTool = createEloquaApplicationItemTool({
  id: 'eloqua_get_email',
  name: 'Get Oracle Eloqua Email',
  description: 'Retrieve one email asset by ID from Oracle Eloqua.',
  path: (id) => `/api/rest/2.0/assets/email/${id}`,
  resource: 'email',
  extraParams: {
    preMerge: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pre-merge field values in the returned email',
    },
    noMergeContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude merged email content',
    },
  },
  query: (params) => ({ preMerge: params.preMerge, noMergeContent: params.noMergeContent }),
})
