import { createEloquaApplicationListTool } from '@/tools/eloqua/factories'

export const eloquaListSegmentsTool = createEloquaApplicationListTool({
  id: 'eloqua_list_segments',
  name: 'List Oracle Eloqua Segments',
  description: 'Retrieve one bounded page of contact segments from Oracle Eloqua.',
  path: '/api/rest/2.0/assets/contact/segments',
  resource: 'segment',
})
