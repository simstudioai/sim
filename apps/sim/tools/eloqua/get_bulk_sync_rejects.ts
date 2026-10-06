import { createEloquaBulkSyncPageTool } from '@/tools/eloqua/factories'

export const eloquaGetBulkSyncRejectsTool = createEloquaBulkSyncPageTool({
  id: 'eloqua_get_bulk_sync_rejects',
  name: 'Get Oracle Eloqua Bulk Sync Rejects',
  description: 'Retrieve one bounded page of rejected records for a Bulk API import sync.',
  suffix: '/rejects',
  includeSearch: true,
  itemKind: 'syncReject',
  maxLimit: 1_000,
})
