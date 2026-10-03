import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesRemoveActivityContactParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesRemoveActivityContactTool =
  createOracleFusionSalesTool<OracleFusionSalesRemoveActivityContactParams>({
    id: 'oracle_fusion_sales_remove_activity_contact',
    operation: 'remove_activity_contact',
    name: 'Oracle Fusion Sales Remove activity contact',
    description: 'Remove activity contact in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
