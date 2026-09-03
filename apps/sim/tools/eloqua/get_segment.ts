import { createEloquaApplicationItemTool } from '@/tools/eloqua/factories'

export const eloquaGetSegmentTool = createEloquaApplicationItemTool({
  id: 'eloqua_get_segment',
  name: 'Get Oracle Eloqua Segment',
  description: 'Retrieve one contact segment by ID from Oracle Eloqua.',
  path: (id) => `/api/rest/2.0/assets/contact/segment/${id}`,
  resource: 'segment',
})
