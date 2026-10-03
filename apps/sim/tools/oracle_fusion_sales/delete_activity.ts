import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesDeleteActivityParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesDeleteActivityTool =
  createOracleFusionSalesTool<OracleFusionSalesDeleteActivityParams>({
    id: 'oracle_fusion_sales_delete_activity',
    operation: 'delete_activity',
    name: 'Oracle Fusion Sales Delete activity',
    description: 'Delete activity in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
