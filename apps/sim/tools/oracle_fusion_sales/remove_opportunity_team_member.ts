import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesRemoveOpportunityTeamMemberParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesRemoveOpportunityTeamMemberTool =
  createOracleFusionSalesTool<OracleFusionSalesRemoveOpportunityTeamMemberParams>({
    id: 'oracle_fusion_sales_remove_opportunity_team_member',
    operation: 'remove_opportunity_team_member',
    name: 'Oracle Fusion Sales Remove opportunity team member',
    description:
      'Remove opportunity team member in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
