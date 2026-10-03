import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesConvertLeadParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesConvertLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesConvertLeadParams>({
    id: 'oracle_fusion_sales_convert_lead',
    operation: 'convert_lead',
    name: 'Oracle Fusion Sales Convert lead',
    description:
      'Convert lead using the Oracle convertLeadToOpty action. Returns the Oracle result string, not a record. Uses convertLeadToOpty; Oracle does not return the created opportunity identifiers through this action.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Oracle action result; inspect this status rather than assuming business success',
      },
    },
  })
