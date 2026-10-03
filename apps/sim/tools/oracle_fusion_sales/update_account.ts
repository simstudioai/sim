import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  type OracleFusionSalesUpdateAccountParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateAccountTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateAccountParams>({
    id: 'oracle_fusion_sales_update_account',
    operation: 'update_account',
    name: 'Oracle Fusion Sales Update account',
    description: 'Update account in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACCOUNT_OUTPUT_PROPERTIES,
      },
    },
  })
