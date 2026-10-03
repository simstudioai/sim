import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  type OracleFusionSalesCreateAccountParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateAccountTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateAccountParams>({
    id: 'oracle_fusion_sales_create_account',
    operation: 'create_account',
    name: 'Oracle Fusion Sales Create account',
    description:
      'Create account in Oracle Fusion Sales using documented CRM REST fields. Address requirements depend on tenant configuration.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACCOUNT_OUTPUT_PROPERTIES,
      },
    },
  })
