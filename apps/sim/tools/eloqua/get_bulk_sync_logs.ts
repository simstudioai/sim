import { createEloquaBulkSyncPageTool } from '@/tools/eloqua/factories'

export const eloquaGetBulkSyncLogsTool = createEloquaBulkSyncPageTool({
  id: 'eloqua_get_bulk_sync_logs',
  name: 'Get Oracle Eloqua Bulk Sync Logs',
  description: 'Retrieve one bounded page of logs for a Bulk API synchronization.',
  suffix: '/logs',
  includeSearch: true,
  itemKind: 'syncLog',
  maxLimit: 1_000,
})
