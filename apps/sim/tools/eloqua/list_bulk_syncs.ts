import { createEloquaBulkListTool } from '@/tools/eloqua/factories'

export const eloquaListBulkSyncsTool = createEloquaBulkListTool({
  id: 'eloqua_list_bulk_syncs',
  name: 'List Oracle Eloqua Bulk Syncs',
  description: 'Retrieve one bounded page of Bulk API synchronizations.',
  path: '/api/bulk/2.0/syncs',
  itemKind: 'sync',
})
