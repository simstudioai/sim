import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesDeleteLeadParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesDeleteLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesDeleteLeadParams>({
    id: 'oracle_fusion_sales_delete_lead',
    operation: 'delete_lead',
    name: 'Oracle Fusion Sales Delete lead',
    description: 'Delete lead in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
