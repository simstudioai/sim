import { createEloquaApplicationMutationTool } from '@/tools/eloqua/factories'

export const eloquaUpdateContactTool = createEloquaApplicationMutationTool({
  id: 'eloqua_update_contact',
  name: 'Update Oracle Eloqua Contact',
  description:
    'Update a contact in Oracle Eloqua. PUT expects a complete contact representation; retrieve the contact first and preserve fields that must not be cleared.',
  method: 'PUT',
  path: (id) => `/api/rest/1.0/data/contact/${id}`,
  resource: 'contact',
  requiresId: true,
  bodyDescription:
    'Complete documented Eloqua Contact representation. Omitted fields may be cleared by full-representation PUT semantics.',
  successStatus: 200,
})
