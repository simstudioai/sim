import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesDeleteAccountParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesDeleteAccountTool =
  createOracleFusionSalesTool<OracleFusionSalesDeleteAccountParams>({
    id: 'oracle_fusion_sales_delete_account',
    operation: 'delete_account',
    name: 'Oracle Fusion Sales Delete account',
    description: 'Delete account in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
