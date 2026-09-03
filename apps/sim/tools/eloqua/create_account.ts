import { createEloquaApplicationMutationTool } from '@/tools/eloqua/factories'

export const eloquaCreateAccountTool = createEloquaApplicationMutationTool({
  id: 'eloqua_create_account',
  name: 'Create Oracle Eloqua Account',
  description: 'Create an account in Oracle Eloqua.',
  method: 'POST',
  path: () => '/api/rest/1.0/data/account',
  resource: 'account',
  bodyDescription:
    'Documented Eloqua Account representation, including optional custom field values',
  successStatus: 201,
})
