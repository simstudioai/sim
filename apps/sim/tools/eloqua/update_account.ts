import { createEloquaApplicationMutationTool } from '@/tools/eloqua/factories'

export const eloquaUpdateAccountTool = createEloquaApplicationMutationTool({
  id: 'eloqua_update_account',
  name: 'Update Oracle Eloqua Account',
  description:
    'Update an account in Oracle Eloqua. PUT expects a complete account representation; retrieve the account first and preserve fields that must not be cleared.',
  method: 'PUT',
  path: (id) => `/api/rest/1.0/data/account/${id}`,
  resource: 'account',
  requiresId: true,
  bodyDescription:
    'Complete documented Eloqua Account representation. Omitted fields may be cleared by full-representation PUT semantics.',
  successStatus: 200,
})
