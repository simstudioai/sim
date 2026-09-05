import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesDeleteContactParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesDeleteContactTool =
  createOracleFusionSalesTool<OracleFusionSalesDeleteContactParams>({
    id: 'oracle_fusion_sales_delete_contact',
    operation: 'delete_contact',
    name: 'Oracle Fusion Sales Delete contact',
    description: 'Delete contact in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
