import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  type OracleFusionSalesGetAccountParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesGetAccountTool =
  createOracleFusionSalesTool<OracleFusionSalesGetAccountParams>({
    id: 'oracle_fusion_sales_get_account',
    operation: 'get_account',
    name: 'Oracle Fusion Sales Get account',
    description: 'Get account in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACCOUNT_OUTPUT_PROPERTIES,
      },
    },
  })
