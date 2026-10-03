import {
  executeOracleEpmAccountReconciliationAddUsersToTeamOperation,
  executeOracleEpmAccountReconciliationArchiveMatchedTransactionsOperation,
  executeOracleEpmAccountReconciliationCreateReconciliationsOperation,
  executeOracleEpmAccountReconciliationDeleteFileOperation,
  executeOracleEpmAccountReconciliationDeleteProfileOperation,
  executeOracleEpmAccountReconciliationDownloadCommentAttachmentOperation,
  executeOracleEpmAccountReconciliationDownloadFileOperation,
  executeOracleEpmAccountReconciliationExportUserDetailsReportOperation,
  executeOracleEpmAccountReconciliationGetComplianceJobStatusOperation,
  executeOracleEpmAccountReconciliationGetMatchingJobStatusOperation,
  executeOracleEpmAccountReconciliationImportBalancesOperation,
  executeOracleEpmAccountReconciliationImportComplianceTransactionsOperation,
  executeOracleEpmAccountReconciliationImportMatchingTransactionsOperation,
  executeOracleEpmAccountReconciliationImportPremappedBalancesOperation,
  executeOracleEpmAccountReconciliationImportProfilesOperation,
  executeOracleEpmAccountReconciliationImportRatesOperation,
  executeOracleEpmAccountReconciliationImportReconciliationAttributesOperation,
  executeOracleEpmAccountReconciliationListFilesOperation,
  executeOracleEpmAccountReconciliationListPeriodsOperation,
  executeOracleEpmAccountReconciliationListReconciliationCommentsOperation,
  executeOracleEpmAccountReconciliationListUsersOperation,
  executeOracleEpmAccountReconciliationMonitorReconciliationsOperation,
  executeOracleEpmAccountReconciliationPurgeArchivedTransactionsOperation,
  executeOracleEpmAccountReconciliationPurgeMatchedTransactionsOperation,
  executeOracleEpmAccountReconciliationRemoveUsersFromTeamOperation,
  executeOracleEpmAccountReconciliationRunAutoAlertOperation,
  executeOracleEpmAccountReconciliationRunAutoMatchOperation,
  executeOracleEpmAccountReconciliationRunProfileRulesOperation,
  executeOracleEpmAccountReconciliationRunReconciliationRulesOperation,
  executeOracleEpmAccountReconciliationSetPeriodStatusOperation,
  executeOracleEpmAccountReconciliationUnmatchAutoMatchJobOperation,
  executeOracleEpmAccountReconciliationUnmatchTransactionsOperation,
  executeOracleEpmAccountReconciliationUploadFileOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOracleEpmAccountReconciliationTool: InternalToolOperationHandler = async (
  request
) => {
  switch (request.toolId) {
    case 'oracle_epm_account_reconciliation_add_users_to_team':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationAddUsersToTeamOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_archive_matched_transactions':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationArchiveMatchedTransactionsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_create_reconciliations':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationCreateReconciliationsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_delete_file':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationDeleteFileOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_delete_profile':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationDeleteProfileOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_download_comment_attachment':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationDownloadCommentAttachmentOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_download_file':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationDownloadFileOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_export_user_details_report':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationExportUserDetailsReportOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_get_compliance_job_status':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationGetComplianceJobStatusOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_get_matching_job_status':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationGetMatchingJobStatusOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_import_balances':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationImportBalancesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_import_compliance_transactions':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationImportComplianceTransactionsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_import_matching_transactions':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationImportMatchingTransactionsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_import_premapped_balances':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationImportPremappedBalancesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_import_profiles':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationImportProfilesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_import_rates':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationImportRatesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_import_recon_attributes':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationImportReconciliationAttributesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_list_files':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationListFilesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_list_periods':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationListPeriodsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_list_reconciliation_comments':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationListReconciliationCommentsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_list_users':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationListUsersOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_monitor_reconciliations':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationMonitorReconciliationsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_purge_archived_transactions':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationPurgeArchivedTransactionsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_purge_matched_transactions':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationPurgeMatchedTransactionsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_remove_users_from_team':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationRemoveUsersFromTeamOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_run_auto_alert':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationRunAutoAlertOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_run_auto_match':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationRunAutoMatchOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_run_profile_rules':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationRunProfileRulesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_run_reconciliation_rules':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationRunReconciliationRulesOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_set_period_status':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationSetPeriodStatusOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_unmatch_auto_match_job':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationUnmatchAutoMatchJobOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_unmatch_transactions':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationUnmatchTransactionsOperation,
        request
      )
    case 'oracle_epm_account_reconciliation_upload_file':
      return executeToolOperationImplementation(
        executeOracleEpmAccountReconciliationUploadFileOperation,
        request
      )
    default:
      return Response.json(
        { success: false, error: 'Unsupported Oracle EPM Account Reconciliation tool' },
        { status: 500 }
      )
  }
}
