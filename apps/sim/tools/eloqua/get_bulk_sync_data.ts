import { createEloquaBulkSyncPageTool } from '@/tools/eloqua/factories'

export const eloquaGetBulkSyncDataTool = createEloquaBulkSyncPageTool({
  id: 'eloqua_get_bulk_sync_data',
  name: 'Get Oracle Eloqua Bulk Sync Data',
  description: 'Retrieve one bounded page of dynamic contact export rows from a completed sync.',
  suffix: '/data',
  itemKind: 'syncData',
  maxLimit: 50_000,
})
