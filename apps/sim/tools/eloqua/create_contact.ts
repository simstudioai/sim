import { createEloquaApplicationMutationTool } from '@/tools/eloqua/factories'

export const eloquaCreateContactTool = createEloquaApplicationMutationTool({
  id: 'eloqua_create_contact',
  name: 'Create Oracle Eloqua Contact',
  description: 'Create a contact in Oracle Eloqua.',
  method: 'POST',
  path: () => '/api/rest/1.0/data/contact',
  resource: 'contact',
  bodyDescription:
    'Documented Eloqua Contact representation, including optional custom field values',
  successStatus: 201,
})
