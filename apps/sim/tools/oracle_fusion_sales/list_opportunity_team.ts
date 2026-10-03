import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesListOpportunityTeamParams,
  PAGINATION_OUTPUTS,
  TEAM_MEMBER_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListOpportunityTeamTool =
  createOracleFusionSalesTool<OracleFusionSalesListOpportunityTeamParams>({
    id: 'oracle_fusion_sales_list_opportunity_team',
    operation: 'list_opportunity_team',
    name: 'Oracle Fusion Sales List opportunity team',
    description:
      'List one bounded page of opportunity team from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: TEAM_MEMBER_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
