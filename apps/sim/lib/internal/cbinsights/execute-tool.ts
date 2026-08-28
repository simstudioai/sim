import {
  executeCbinsightsChatOperation,
  executeCbinsightsGetCommercialMaturityHistoryOperation,
  executeCbinsightsGetExitProbabilityHistoryOperation,
  executeCbinsightsGetMosaicHistoryOperation,
  executeCbinsightsGetOrgBusinessRelationshipsOperation,
  executeCbinsightsGetOrgFundingsOperation,
  executeCbinsightsGetOrgFundingWindowOperation,
  executeCbinsightsGetOrgInvestmentsOperation,
  executeCbinsightsGetOrgManagementAndBoardOperation,
  executeCbinsightsGetOrgOutlookOperation,
  executeCbinsightsGetOrgPortfolioExitsOperation,
  executeCbinsightsGetOrgRevenueOperation,
  executeCbinsightsGetScoutingReportOperation,
  executeCbinsightsGetStrategyMapOperation,
  executeCbinsightsListBusinessRelationshipsOperation,
  executeCbinsightsListFundingsOperation,
  executeCbinsightsListFundingWindowOperation,
  executeCbinsightsListInvestmentsOperation,
  executeCbinsightsListManagementAndBoardOperation,
  executeCbinsightsListOutlookOperation,
  executeCbinsightsListPortfolioExitsOperation,
  executeCbinsightsListRevenueOperation,
  executeCbinsightsLookupOrganizationsOperation,
  executeCbinsightsRagOperation,
  executeCbinsightsSearchFirmographicsOperation,
} from '@/lib/internal/cbinsights/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeCbinsightsTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'cbinsights_chat':
      return executeToolOperationImplementation(executeCbinsightsChatOperation, request)
    case 'cbinsights_get_commercial_maturity_history':
      return executeToolOperationImplementation(
        executeCbinsightsGetCommercialMaturityHistoryOperation,
        request
      )
    case 'cbinsights_get_exit_probability_history':
      return executeToolOperationImplementation(
        executeCbinsightsGetExitProbabilityHistoryOperation,
        request
      )
    case 'cbinsights_get_mosaic_history':
      return executeToolOperationImplementation(executeCbinsightsGetMosaicHistoryOperation, request)
    case 'cbinsights_get_org_business_relationships':
      return executeToolOperationImplementation(
        executeCbinsightsGetOrgBusinessRelationshipsOperation,
        request
      )
    case 'cbinsights_get_org_funding_window':
      return executeToolOperationImplementation(
        executeCbinsightsGetOrgFundingWindowOperation,
        request
      )
    case 'cbinsights_get_org_fundings':
      return executeToolOperationImplementation(executeCbinsightsGetOrgFundingsOperation, request)
    case 'cbinsights_get_org_investments':
      return executeToolOperationImplementation(
        executeCbinsightsGetOrgInvestmentsOperation,
        request
      )
    case 'cbinsights_get_org_management_and_board':
      return executeToolOperationImplementation(
        executeCbinsightsGetOrgManagementAndBoardOperation,
        request
      )
    case 'cbinsights_get_org_outlook':
      return executeToolOperationImplementation(executeCbinsightsGetOrgOutlookOperation, request)
    case 'cbinsights_get_org_portfolio_exits':
      return executeToolOperationImplementation(
        executeCbinsightsGetOrgPortfolioExitsOperation,
        request
      )
    case 'cbinsights_get_org_revenue':
      return executeToolOperationImplementation(executeCbinsightsGetOrgRevenueOperation, request)
    case 'cbinsights_get_scouting_report':
      return executeToolOperationImplementation(
        executeCbinsightsGetScoutingReportOperation,
        request
      )
    case 'cbinsights_get_strategy_map':
      return executeToolOperationImplementation(executeCbinsightsGetStrategyMapOperation, request)
    case 'cbinsights_list_business_relationships':
      return executeToolOperationImplementation(
        executeCbinsightsListBusinessRelationshipsOperation,
        request
      )
    case 'cbinsights_list_funding_window':
      return executeToolOperationImplementation(
        executeCbinsightsListFundingWindowOperation,
        request
      )
    case 'cbinsights_list_fundings':
      return executeToolOperationImplementation(executeCbinsightsListFundingsOperation, request)
    case 'cbinsights_list_investments':
      return executeToolOperationImplementation(executeCbinsightsListInvestmentsOperation, request)
    case 'cbinsights_list_management_and_board':
      return executeToolOperationImplementation(
        executeCbinsightsListManagementAndBoardOperation,
        request
      )
    case 'cbinsights_list_outlook':
      return executeToolOperationImplementation(executeCbinsightsListOutlookOperation, request)
    case 'cbinsights_list_portfolio_exits':
      return executeToolOperationImplementation(
        executeCbinsightsListPortfolioExitsOperation,
        request
      )
    case 'cbinsights_list_revenue':
      return executeToolOperationImplementation(executeCbinsightsListRevenueOperation, request)
    case 'cbinsights_lookup_organizations':
      return executeToolOperationImplementation(
        executeCbinsightsLookupOrganizationsOperation,
        request
      )
    case 'cbinsights_rag':
      return executeToolOperationImplementation(executeCbinsightsRagOperation, request)
    case 'cbinsights_search_firmographics':
      return executeToolOperationImplementation(
        executeCbinsightsSearchFirmographicsOperation,
        request
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported cbinsights tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
