import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesCreateCallReportParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateCallReportTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateCallReportParams>({
    id: 'oracle_fusion_sales_create_call_report',
    operation: 'create_call_report',
    name: 'Oracle Fusion Sales Create call report',
    description: 'Create call report in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACTIVITY_OUTPUT_PROPERTIES,
      },
    },
  })
