import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OracleEpmAccountReconciliationResponse } from '@/tools/oracle_epm_account_reconciliation/types'
import {
  optionalBoolean,
  optionalString,
  parseJson,
} from '@/tools/oracle_epm_account_reconciliation/utils'

export const OracleEpmAccountReconciliationBlock: BlockConfig<OracleEpmAccountReconciliationResponse> =
  {
    type: 'oracle_epm_account_reconciliation',
    name: 'Oracle EPM Account Reconciliation',
    description: 'Automate reconciliation, transaction matching, imports, and audit evidence',
    longDescription:
      'Connect an Oracle EPM service-account credential to automate Reconciliation Compliance and Transaction Matching. Stage files explicitly, import profiles, balances, rates and transactions, run rules and matching jobs, manage period status and team membership, and retrieve comments, attachments and user reports. Operations require their documented Oracle roles and enabled features. Jobs launch without waiting by default; a requested wait is bounded to 5–300 seconds. Files are limited to 100 MB. This integration does not provide general reconciliation or profile CRUD, generic report execution, or machine-learning operations.',
    docsLink: 'https://docs.sim.ai/integrations/oracle_epm_account_reconciliation',
    authMode: AuthMode.ApiKey,
    category: 'tools',
    integrationType: IntegrationType.Commerce,
    bgColor: '#FFFFFF',
    icon: NetSuiteIcon,
    canvasPresentation: {
      defaultTitle: 'Oracle EPM Account Reconciliation',
      sentences: {
        byOperation: {
          add_users_to_team: [
            {
              text: 'Add users to team',
              field: 'teamName',
              core: true,
            },
          ],
          archive_matched_transactions: [
            {
              text: 'Archive Matched Transactions for',
              field: 'matchTypeId',
              core: true,
            },
          ],
          create_reconciliations: [
            {
              text: 'Create Reconciliations for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          delete_file: [
            {
              text: 'Delete repository file',
              field: ['repositoryFileSelector', 'manualRepositoryFile'],
              core: true,
            },
          ],
          delete_profile: [
            {
              text: 'Delete profile',
              field: 'accountId',
              core: true,
            },
          ],
          download_comment_attachment: [
            {
              text: 'Download attachment',
              field: 'referenceId',
              core: true,
            },
            {
              text: 'for account',
              field: 'accountId',
              core: true,
            },
          ],
          download_file: [
            {
              text: 'Download repository file',
              field: ['repositoryFileSelector', 'manualRepositoryFile'],
              core: true,
            },
          ],
          export_user_details_report: ['Export User Details Report'],
          get_compliance_job_status: [
            {
              text: 'Get Compliance Job Status for',
              field: 'jobId',
              core: true,
            },
          ],
          get_matching_job_status: [
            {
              text: 'Get Matching Job Status for',
              field: 'jobId',
              core: true,
            },
          ],
          import_balances: [
            {
              text: 'Import Balances for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          import_compliance_transactions: [
            {
              text: 'Import Compliance Transactions for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          import_matching_transactions: [
            {
              text: 'Import Matching Transactions for',
              field: 'matchTypeId',
              core: true,
            },
          ],
          import_premapped_balances: [
            {
              text: 'Import Premapped Balances for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          import_profiles: [
            'Import Profiles',
            {
              text: 'for',
              field: ['periodSelector', 'manualPeriod'],
            },
          ],
          import_rates: [
            {
              text: 'Import Rates for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          import_reconciliation_attributes: [
            {
              text: 'Import Reconciliation Attributes for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          list_files: ['List Files'],
          list_periods: ['List Periods'],
          list_reconciliation_comments: [
            {
              text: 'List Reconciliation Comments for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          list_users: ['List Users'],
          monitor_reconciliations: [
            {
              text: 'Monitor reconciliations in',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
            {
              text: 'matching',
              field: 'filterName',
              core: true,
            },
          ],
          purge_archived_transactions: [
            {
              text: 'Purge Archived Transactions for',
              field: 'jobId',
              core: true,
            },
          ],
          purge_matched_transactions: [
            {
              text: 'Purge Matched Transactions for',
              field: 'matchTypeId',
              core: true,
            },
          ],
          remove_users_from_team: [
            {
              text: 'Remove users from team',
              field: 'teamName',
              core: true,
            },
          ],
          run_auto_alert: [
            {
              text: 'Run Auto Alert for',
              field: 'matchTypeId',
              core: true,
            },
          ],
          run_auto_match: [
            {
              text: 'Run Auto Match for',
              field: 'matchTypeId',
              core: true,
            },
          ],
          run_profile_rules: [
            {
              text: 'Run Profile Rules for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          run_reconciliation_rules: [
            {
              text: 'Run Reconciliation Rules for',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
          ],
          set_period_status: [
            {
              text: 'Set period',
              field: ['periodSelector', 'manualPeriod'],
              core: true,
            },
            {
              text: 'to',
              field: 'periodStatus',
              core: true,
            },
          ],
          unmatch_auto_match_job: ['Unmatch Auto Match Job'],
          unmatch_transactions: [
            {
              text: 'Unmatch Transactions for',
              field: 'matchTypeId',
              core: true,
            },
          ],
          upload_file: [
            {
              text: 'Upload',
              field: ['uploadFile', 'fileRef'],
              core: true,
            },
          ],
        },
      },
    },
    subBlocks: [
      {
        id: 'credential',
        title: 'Oracle EPM Account',
        type: 'oauth-input',
        serviceId: 'oracle-epm-account-reconciliation',
        requiredScopes: getScopesForService('oracle-epm-account-reconciliation'),
        credentialKind: 'service-account',
        canonicalParamId: 'oauthCredential',
        mode: 'basic',
        placeholder: 'Select Oracle EPM credential',
        required: true,
      },
      {
        id: 'manualCredential',
        title: 'Oracle EPM Account',
        type: 'short-input',
        canonicalParamId: 'oauthCredential',
        mode: 'advanced',
        placeholder: 'Enter credential ID',
        required: true,
      },
      {
        id: 'operation',
        title: 'Operation',
        type: 'dropdown',
        options: [
          {
            id: 'add_users_to_team',
            label: 'Add Users to Team',
          },
          {
            id: 'archive_matched_transactions',
            label: 'Archive Matched Transactions',
          },
          {
            id: 'create_reconciliations',
            label: 'Create Reconciliations',
          },
          {
            id: 'delete_file',
            label: 'Delete File',
          },
          {
            id: 'delete_profile',
            label: 'Delete Profile',
          },
          {
            id: 'download_comment_attachment',
            label: 'Download Comment Attachment',
          },
          {
            id: 'download_file',
            label: 'Download File',
          },
          {
            id: 'export_user_details_report',
            label: 'Export User Details Report',
          },
          {
            id: 'get_compliance_job_status',
            label: 'Get Compliance Job Status',
          },
          {
            id: 'get_matching_job_status',
            label: 'Get Matching Job Status',
          },
          {
            id: 'import_balances',
            label: 'Import Balances',
          },
          {
            id: 'import_compliance_transactions',
            label: 'Import Compliance Transactions',
          },
          {
            id: 'import_matching_transactions',
            label: 'Import Matching Transactions',
          },
          {
            id: 'import_premapped_balances',
            label: 'Import Premapped Balances',
          },
          {
            id: 'import_profiles',
            label: 'Import Profiles',
          },
          {
            id: 'import_rates',
            label: 'Import Rates',
          },
          {
            id: 'import_reconciliation_attributes',
            label: 'Import Reconciliation Attributes',
          },
          {
            id: 'list_files',
            label: 'List Files',
          },
          {
            id: 'list_periods',
            label: 'List Periods',
          },
          {
            id: 'list_reconciliation_comments',
            label: 'List Reconciliation Comments',
          },
          {
            id: 'list_users',
            label: 'List Users',
          },
          {
            id: 'monitor_reconciliations',
            label: 'Monitor Reconciliations',
          },
          {
            id: 'purge_archived_transactions',
            label: 'Purge Archived Transactions',
          },
          {
            id: 'purge_matched_transactions',
            label: 'Purge Matched Transactions',
          },
          {
            id: 'remove_users_from_team',
            label: 'Remove Users from Team',
          },
          {
            id: 'run_auto_alert',
            label: 'Run Auto Alert',
          },
          {
            id: 'run_auto_match',
            label: 'Run Auto Match',
          },
          {
            id: 'run_profile_rules',
            label: 'Run Profile Rules',
          },
          {
            id: 'run_reconciliation_rules',
            label: 'Run Reconciliation Rules',
          },
          {
            id: 'set_period_status',
            label: 'Set Period Status',
          },
          {
            id: 'unmatch_auto_match_job',
            label: 'Unmatch Auto Match Job',
          },
          {
            id: 'unmatch_transactions',
            label: 'Unmatch Transactions',
          },
          {
            id: 'upload_file',
            label: 'Upload File',
          },
        ],
        value: () => 'list_periods',
        required: true,
      },
      {
        id: 'repositoryFileSelector',
        title: 'Repository File',
        type: 'project-selector',
        canonicalParamId: 'fileName',
        serviceId: 'oracle-epm-account-reconciliation',
        selectorKey: 'oracleEpmAccountReconciliation.files',
        dependsOn: ['credential'],
        mode: 'basic',
        required: true,
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'delete_file',
            'download_file',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'remove_users_from_team',
          ],
        },
        placeholder: 'Select repository file',
      },
      {
        id: 'manualRepositoryFile',
        title: 'Repository File',
        type: 'short-input',
        canonicalParamId: 'fileName',
        mode: 'advanced',
        required: true,
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'delete_file',
            'download_file',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'remove_users_from_team',
          ],
        },
        placeholder: 'Exact name of a file already uploaded to the Oracle EPM repository',
      },
      {
        id: 'teamName',
        title: 'Team Name',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['add_users_to_team', 'remove_users_from_team'],
        },
        placeholder: 'Name of an existing Account Reconciliation team',
      },
      {
        id: 'waitForCompletion',
        title: 'Wait For Completion',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'archive_matched_transactions',
            'create_reconciliations',
            'delete_profile',
            'import_balances',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'remove_users_from_team',
            'run_auto_alert',
            'run_auto_match',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
            'unmatch_auto_match_job',
            'unmatch_transactions',
          ],
        },
        placeholder: 'Wait for the accepted job to finish (default false)',
        mode: 'advanced',
      },
      {
        id: 'maxWaitSeconds',
        title: 'Max Wait Seconds',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'archive_matched_transactions',
            'create_reconciliations',
            'delete_profile',
            'export_user_details_report',
            'import_balances',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'remove_users_from_team',
            'run_auto_alert',
            'run_auto_match',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
            'unmatch_auto_match_job',
            'unmatch_transactions',
          ],
        },
        placeholder: 'Maximum wait in seconds (5–300; default 60)',
        mode: 'advanced',
        value: () => '60',
      },
      {
        id: 'matchTypeId',
        title: 'Match Type ID',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: [
            'archive_matched_transactions',
            'import_matching_transactions',
            'purge_matched_transactions',
            'run_auto_alert',
            'run_auto_match',
            'unmatch_transactions',
          ],
        },
        placeholder: 'Text ID of the Transaction Matching match type',
      },
      {
        id: 'age',
        title: 'Age',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['archive_matched_transactions', 'purge_matched_transactions'],
        },
        placeholder: 'Age in days of matched transactions to archive',
      },
      {
        id: 'filterOperator',
        title: 'Filter Operator',
        type: 'dropdown',
        required: false,
        condition: {
          field: 'operation',
          value: ['archive_matched_transactions', 'purge_matched_transactions'],
        },
        placeholder: 'Account ID filter operator; provide with filterValue',
        mode: 'advanced',
        options: [
          {
            id: 'EQUALS',
            label: 'EQUALS',
          },
          {
            id: 'NOT_EQUALS',
            label: 'NOT_EQUALS',
          },
          {
            id: 'STARTS_WITH',
            label: 'STARTS_WITH',
          },
          {
            id: 'ENDS_WITH',
            label: 'ENDS_WITH',
          },
          {
            id: 'CONTAINS',
            label: 'CONTAINS',
          },
          {
            id: 'NOT_CONTAINS',
            label: 'NOT_CONTAINS',
          },
        ],
      },
      {
        id: 'filterValue',
        title: 'Filter Value',
        type: 'long-input',
        required: false,
        condition: {
          field: 'operation',
          value: ['archive_matched_transactions', 'purge_matched_transactions'],
        },
        placeholder: 'Account ID filter values as a JSON string array',
        mode: 'advanced',
        wandConfig: {
          enabled: true,
          prompt: 'Account ID filter values as a JSON string array. Return ONLY the JSON array',
          placeholder: 'Describe filter value',
          generationType: 'json-object',
        },
      },
      {
        id: 'logFileName',
        title: 'Log File Name',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: [
            'archive_matched_transactions',
            'purge_archived_transactions',
            'purge_matched_transactions',
          ],
        },
        placeholder: 'Optional output log filename',
        mode: 'advanced',
      },
      {
        id: 'outputFileName',
        title: 'Output Filename',
        type: 'short-input',
        required: {
          field: 'operation',
          value: ['export_user_details_report'],
        },
        condition: {
          field: 'operation',
          value: ['archive_matched_transactions', 'export_user_details_report', 'upload_file'],
        },
        placeholder: 'Report filename, or optional archive/upload filename',
      },
      {
        id: 'periodSelector',
        title: 'Period',
        type: 'project-selector',
        canonicalParamId: 'period',
        serviceId: 'oracle-epm-account-reconciliation',
        selectorKey: 'oracleEpmAccountReconciliation.periods',
        dependsOn: ['credential'],
        mode: 'basic',
        required: {
          field: 'operation',
          value: [
            'create_reconciliations',
            'download_comment_attachment',
            'import_balances',
            'import_compliance_transactions',
            'import_premapped_balances',
            'import_rates',
            'import_reconciliation_attributes',
            'list_reconciliation_comments',
            'monitor_reconciliations',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
          ],
        },
        condition: {
          field: 'operation',
          value: [
            'create_reconciliations',
            'download_comment_attachment',
            'import_balances',
            'import_compliance_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'list_reconciliation_comments',
            'monitor_reconciliations',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
          ],
        },
        placeholder: 'Select period',
      },
      {
        id: 'manualPeriod',
        title: 'Period',
        type: 'short-input',
        canonicalParamId: 'period',
        mode: 'advanced',
        required: {
          field: 'operation',
          value: [
            'create_reconciliations',
            'download_comment_attachment',
            'import_balances',
            'import_compliance_transactions',
            'import_premapped_balances',
            'import_rates',
            'import_reconciliation_attributes',
            'list_reconciliation_comments',
            'monitor_reconciliations',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
          ],
        },
        condition: {
          field: 'operation',
          value: [
            'create_reconciliations',
            'download_comment_attachment',
            'import_balances',
            'import_compliance_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'list_reconciliation_comments',
            'monitor_reconciliations',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
          ],
        },
        placeholder: 'Reconciliation period name, not its internal ID',
      },
      {
        id: 'filter',
        title: 'Filter',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: ['create_reconciliations', 'run_profile_rules', 'run_reconciliation_rules'],
        },
        placeholder: 'Name of a public filter; omit to process all applicable objects',
        mode: 'advanced',
        wandConfig: {
          enabled: true,
          prompt:
            'Name of a public filter; omit to process all applicable objects. Return ONLY the text value',
          placeholder: 'Describe filter',
        },
      },
      {
        id: 'accountId',
        title: 'Account ID',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['delete_profile', 'download_comment_attachment', 'list_reconciliation_comments'],
        },
        placeholder: 'Account ID of the profile to delete',
      },
      {
        id: 'referenceId',
        title: 'Reference ID',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['download_comment_attachment'],
        },
        placeholder: 'FILE reference ID returned by List Reconciliation Comments',
      },
      {
        id: 'format',
        title: 'Format',
        type: 'dropdown',
        required: false,
        condition: {
          field: 'operation',
          value: ['export_user_details_report'],
        },
        placeholder: 'Report format',
        mode: 'advanced',
        options: [
          {
            id: 'CSV',
            label: 'CSV',
          },
          {
            id: 'XLS',
            label: 'XLS',
          },
        ],
        value: () => 'CSV',
      },
      {
        id: 'jobId',
        title: 'Job ID',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: [
            'get_compliance_job_status',
            'get_matching_job_status',
            'purge_archived_transactions',
          ],
        },
        placeholder: 'Job ID; for purge, use the completed archive job ID',
      },
      {
        id: 'dataLoadDefinition',
        title: 'Data Load Definition',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_balances'],
        },
        placeholder: 'Name of the configured data-load definition',
      },
      {
        id: 'transactionType',
        title: 'Transaction Type',
        type: 'dropdown',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_compliance_transactions'],
        },
        placeholder: 'BEX balance explanations, SRC/SUB adjustments, or VEX variance explanations',
        options: [
          {
            id: 'BEX',
            label: 'BEX',
          },
          {
            id: 'SRC',
            label: 'SRC',
          },
          {
            id: 'SUB',
            label: 'SUB',
          },
          {
            id: 'VEX',
            label: 'VEX',
          },
        ],
      },
      {
        id: 'dateFormat',
        title: 'Date Format',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: [
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_profiles',
          ],
        },
        placeholder: 'Date format used in the import file, for example MMM d, yyyy',
        wandConfig: {
          enabled: true,
          prompt:
            'Date format used in the import file, for example MMM d, yyyy. Return ONLY the text value',
          placeholder: 'Describe date format',
        },
      },
      {
        id: 'dataSource',
        title: 'Data Source',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_matching_transactions'],
        },
        placeholder: 'Text ID of the Transaction Matching data source',
      },
      {
        id: 'balanceType',
        title: 'Balance Type',
        type: 'dropdown',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_premapped_balances'],
        },
        placeholder: 'SRC for source system or SUB for subsystem',
        options: [
          {
            id: 'SRC',
            label: 'SRC',
          },
          {
            id: 'SUB',
            label: 'SUB',
          },
        ],
      },
      {
        id: 'currencyBucket',
        title: 'Currency Bucket',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_premapped_balances'],
        },
        placeholder: 'Configured currency bucket, for example Entered',
      },
      {
        id: 'profileImportType',
        title: 'Profile Import Method',
        type: 'dropdown',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_profiles'],
        },
        placeholder: 'Profile import method',
        options: [
          {
            id: 'Replace',
            label: 'Replace',
          },
          {
            id: 'Update',
            label: 'Update',
          },
        ],
      },
      {
        id: 'profileType',
        title: 'Profile Type',
        type: 'dropdown',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_profiles'],
        },
        placeholder: 'Type of profile definitions',
        options: [
          {
            id: 'Profiles',
            label: 'Profiles',
          },
          {
            id: 'Children',
            label: 'Children',
          },
        ],
      },
      {
        id: 'rateType',
        title: 'Rate Type',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_rates'],
        },
        placeholder: 'Currency rate type',
      },
      {
        id: 'rateImportType',
        title: 'Rate Import Method',
        type: 'dropdown',
        required: true,
        condition: {
          field: 'operation',
          value: ['import_rates'],
        },
        placeholder: 'Currency-rate import method',
        options: [
          {
            id: 'Replace',
            label: 'Replace',
          },
          {
            id: 'ReplaceAll',
            label: 'ReplaceAll',
          },
        ],
      },
      {
        id: 'rules',
        title: 'Rules',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: ['import_reconciliation_attributes'],
        },
        placeholder:
          'Comma-separated ALL, SET_ATTR_VAL, CRT_ALT, AUTO_APP, or AUTO_SUB; omit to run no rules',
        mode: 'advanced',
        wandConfig: {
          enabled: true,
          prompt:
            'Comma-separated ALL, SET_ATTR_VAL, CRT_ALT, AUTO_APP, or AUTO_SUB; omit to run no rules. Return ONLY the text value',
          placeholder: 'Describe rules',
        },
      },
      {
        id: 'reopen',
        title: 'Reopen',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: ['import_reconciliation_attributes'],
        },
        placeholder: 'Reopen changed reconciliations after import',
        mode: 'advanced',
      },
      {
        id: 'periodStatusFilter',
        title: 'Period Status Filter',
        type: 'dropdown',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_periods'],
        },
        placeholder: 'Period status filter',
        mode: 'advanced',
        options: [
          {
            id: 'ALL',
            label: 'ALL',
          },
          {
            id: 'OPEN',
            label: 'OPEN',
          },
          {
            id: 'CLOSED',
            label: 'CLOSED',
          },
          {
            id: 'LOCKED',
            label: 'LOCKED',
          },
          {
            id: 'PENDING',
            label: 'PENDING',
          },
          {
            id: 'OPEN_PENDING',
            label: 'OPEN_PENDING',
          },
        ],
        value: () => 'ALL',
      },
      {
        id: 'userlogin',
        title: 'User Login',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
        placeholder: 'Filter by user login',
        mode: 'advanced',
      },
      {
        id: 'userattribute',
        title: 'User Attribute Search',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
        placeholder: 'Case-insensitive search across user login, first name, last name, or email',
        mode: 'advanced',
      },
      {
        id: 'epmgroups',
        title: 'Include EPM Groups',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
        placeholder: 'Include EPM groups',
        mode: 'advanced',
      },
      {
        id: 'idcsgroups',
        title: 'Include IDCS Groups',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
        placeholder: 'Include IDCS groups',
        mode: 'advanced',
      },
      {
        id: 'applicationroles',
        title: 'Include Application Roles',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
        placeholder: 'Include application roles',
        mode: 'advanced',
      },
      {
        id: 'granularroles',
        title: 'Include Granular Roles',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
        placeholder: 'Include granular roles',
        mode: 'advanced',
      },
      {
        id: 'indirect',
        title: 'Include Indirect Memberships',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
        placeholder: 'Include both direct and indirect memberships',
        mode: 'advanced',
      },
      {
        id: 'filterName',
        title: 'Filter Name',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['monitor_reconciliations'],
        },
        placeholder: 'Name of a public reconciliation filter',
        wandConfig: {
          enabled: true,
          prompt: 'Name of a public reconciliation filter. Return ONLY the text value',
          placeholder: 'Describe filter name',
        },
      },
      {
        id: 'ruleTypes',
        title: 'Rule Types',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: ['run_reconciliation_rules'],
        },
        placeholder:
          'Case-insensitive comma-separated rule types; omit to run all applicable rules',
        mode: 'advanced',
        wandConfig: {
          enabled: true,
          prompt:
            'Case-insensitive comma-separated rule types; omit to run all applicable rules. Return ONLY the text value',
          placeholder: 'Describe rule types',
        },
      },
      {
        id: 'periodStatus',
        title: 'New Period Status',
        type: 'dropdown',
        required: true,
        condition: {
          field: 'operation',
          value: ['set_period_status'],
        },
        placeholder: 'New period status',
        options: [
          {
            id: 'pending',
            label: 'pending',
          },
          {
            id: 'open',
            label: 'open',
          },
          {
            id: 'closed',
            label: 'closed',
          },
          {
            id: 'locked',
            label: 'locked',
          },
        ],
      },
      {
        id: 'autoMatchJobId',
        title: 'Auto Match Job ID',
        type: 'short-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['unmatch_auto_match_job'],
        },
        placeholder: 'ID of the auto-match or import-and-auto-match job',
      },
      {
        id: 'createReverseAdjustment',
        title: 'Create Reverse Adjustment',
        type: 'switch',
        required: true,
        condition: {
          field: 'operation',
          value: ['unmatch_auto_match_job'],
        },
        placeholder: 'Create reverse adjustments for unmatched transactions',
      },
      {
        id: 'matchIds',
        title: 'Match IDs',
        type: 'long-input',
        required: true,
        condition: {
          field: 'operation',
          value: ['unmatch_transactions'],
        },
        placeholder: 'JSON array of numeric match IDs (maximum 10,000)',
        wandConfig: {
          enabled: true,
          prompt: 'JSON array of numeric match IDs (maximum 10,000). Return ONLY the JSON array',
          placeholder: 'Describe match ids',
          generationType: 'json-object',
        },
      },
      {
        id: 'forceReopen',
        title: 'Force Reopen',
        type: 'switch',
        required: false,
        condition: {
          field: 'operation',
          value: ['unmatch_transactions'],
        },
        placeholder: 'Reopen affected reconciliations when required',
        mode: 'advanced',
      },
      {
        id: 'uploadFile',
        title: 'File',
        type: 'file-upload',
        canonicalParamId: 'file',
        mode: 'basic',
        multiple: false,
        required: true,
        condition: {
          field: 'operation',
          value: ['upload_file'],
        },
      },
      {
        id: 'fileRef',
        title: 'File',
        type: 'short-input',
        canonicalParamId: 'file',
        mode: 'advanced',
        required: true,
        condition: {
          field: 'operation',
          value: ['upload_file'],
        },
        placeholder: 'Reference a file from a previous block',
      },
      {
        id: 'extDirPath',
        title: 'Upload Directory',
        type: 'short-input',
        required: false,
        condition: {
          field: 'operation',
          value: ['upload_file'],
        },
        placeholder: 'Optional Data Management directory, such as inbox or inbox/data',
        mode: 'advanced',
      },
    ],
    tools: {
      access: [
        'oracle_epm_account_reconciliation_add_users_to_team',
        'oracle_epm_account_reconciliation_archive_matched_transactions',
        'oracle_epm_account_reconciliation_create_reconciliations',
        'oracle_epm_account_reconciliation_delete_file',
        'oracle_epm_account_reconciliation_delete_profile',
        'oracle_epm_account_reconciliation_download_comment_attachment',
        'oracle_epm_account_reconciliation_download_file',
        'oracle_epm_account_reconciliation_export_user_details_report',
        'oracle_epm_account_reconciliation_get_compliance_job_status',
        'oracle_epm_account_reconciliation_get_matching_job_status',
        'oracle_epm_account_reconciliation_import_balances',
        'oracle_epm_account_reconciliation_import_compliance_transactions',
        'oracle_epm_account_reconciliation_import_matching_transactions',
        'oracle_epm_account_reconciliation_import_premapped_balances',
        'oracle_epm_account_reconciliation_import_profiles',
        'oracle_epm_account_reconciliation_import_rates',
        'oracle_epm_account_reconciliation_import_recon_attributes',
        'oracle_epm_account_reconciliation_list_files',
        'oracle_epm_account_reconciliation_list_periods',
        'oracle_epm_account_reconciliation_list_reconciliation_comments',
        'oracle_epm_account_reconciliation_list_users',
        'oracle_epm_account_reconciliation_monitor_reconciliations',
        'oracle_epm_account_reconciliation_purge_archived_transactions',
        'oracle_epm_account_reconciliation_purge_matched_transactions',
        'oracle_epm_account_reconciliation_remove_users_from_team',
        'oracle_epm_account_reconciliation_run_auto_alert',
        'oracle_epm_account_reconciliation_run_auto_match',
        'oracle_epm_account_reconciliation_run_profile_rules',
        'oracle_epm_account_reconciliation_run_reconciliation_rules',
        'oracle_epm_account_reconciliation_set_period_status',
        'oracle_epm_account_reconciliation_unmatch_auto_match_job',
        'oracle_epm_account_reconciliation_unmatch_transactions',
        'oracle_epm_account_reconciliation_upload_file',
      ],
      config: {
        tool: (params) => {
          switch (params.operation) {
            case 'import_reconciliation_attributes':
              return 'oracle_epm_account_reconciliation_import_recon_attributes'
            default:
              return `oracle_epm_account_reconciliation_${params.operation ?? 'list_periods'}`
          }
        },
        params: (params) => {
          switch (params.operation ?? 'list_periods') {
            case 'add_users_to_team':
              return {
                ...params,
                fileName: params.fileName,
                teamName: params.teamName,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'archive_matched_transactions':
              return {
                ...params,
                matchTypeId: params.matchTypeId,
                age: parseOptionalNumberInput(params.age, 'Age', { integer: true, min: 0 }),
                filterOperator: optionalString(params.filterOperator),
                filterValue: parseJson(params.filterValue, 'Filter Value'),
                logFileName: optionalString(params.logFileName),
                fileName: optionalString(params.outputFileName),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'create_reconciliations':
              return {
                ...params,
                period: params.period,
                filter: optionalString(params.filter),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'delete_file':
              return { ...params, fileName: params.fileName }
            case 'delete_profile':
              return {
                ...params,
                accountId: params.accountId,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'download_comment_attachment':
              return {
                ...params,
                period: params.period,
                accountId: params.accountId,
                referenceId: params.referenceId,
              }
            case 'download_file':
              return { ...params, fileName: params.fileName }
            case 'export_user_details_report':
              return {
                ...params,
                fileName: params.outputFileName,
                format: optionalString(params.format),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'get_compliance_job_status':
              return { ...params, jobId: params.jobId }
            case 'get_matching_job_status':
              return { ...params, jobId: params.jobId }
            case 'import_balances':
              return {
                ...params,
                period: params.period,
                dataLoadDefinition: params.dataLoadDefinition,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'import_compliance_transactions':
              return {
                ...params,
                fileName: params.fileName,
                period: params.period,
                transactionType: params.transactionType,
                dateFormat: params.dateFormat,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'import_matching_transactions':
              return {
                ...params,
                fileName: params.fileName,
                matchTypeId: params.matchTypeId,
                dataSource: params.dataSource,
                dateFormat: params.dateFormat,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'import_premapped_balances':
              return {
                ...params,
                fileName: params.fileName,
                period: params.period,
                balanceType: params.balanceType,
                currencyBucket: params.currencyBucket,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'import_profiles':
              return {
                ...params,
                fileName: params.fileName,
                importType: params.profileImportType,
                profileType: params.profileType,
                dateFormat: params.dateFormat,
                period: optionalString(params.period),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'import_rates':
              return {
                ...params,
                fileName: params.fileName,
                period: params.period,
                rateType: params.rateType,
                importType: params.rateImportType,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'import_reconciliation_attributes':
              return {
                ...params,
                fileName: params.fileName,
                period: params.period,
                rules: optionalString(params.rules),
                reopen: optionalBoolean(params.reopen),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'list_files':
              return { ...params }
            case 'list_periods':
              return { ...params, status: optionalString(params.periodStatusFilter) }
            case 'list_reconciliation_comments':
              return { ...params, period: params.period, accountId: params.accountId }
            case 'list_users':
              return {
                ...params,
                userlogin: optionalString(params.userlogin),
                userattribute: optionalString(params.userattribute),
                epmgroups: optionalBoolean(params.epmgroups),
                idcsgroups: optionalBoolean(params.idcsgroups),
                applicationroles: optionalBoolean(params.applicationroles),
                granularroles: optionalBoolean(params.granularroles),
                indirect: optionalBoolean(params.indirect),
              }
            case 'monitor_reconciliations':
              return { ...params, periodName: params.period, filterName: params.filterName }
            case 'purge_archived_transactions':
              return {
                ...params,
                jobId: params.jobId,
                logFileName: optionalString(params.logFileName),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'purge_matched_transactions':
              return {
                ...params,
                matchTypeId: params.matchTypeId,
                age: parseOptionalNumberInput(params.age, 'Age', { integer: true, min: 0 }),
                filterOperator: optionalString(params.filterOperator),
                filterValue: parseJson(params.filterValue, 'Filter Value'),
                logFileName: optionalString(params.logFileName),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'remove_users_from_team':
              return {
                ...params,
                fileName: params.fileName,
                teamName: params.teamName,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'run_auto_alert':
              return {
                ...params,
                matchTypeId: params.matchTypeId,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'run_auto_match':
              return {
                ...params,
                matchTypeId: params.matchTypeId,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'run_profile_rules':
              return {
                ...params,
                period: params.period,
                filter: optionalString(params.filter),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'run_reconciliation_rules':
              return {
                ...params,
                period: params.period,
                filter: optionalString(params.filter),
                ruleTypes: optionalString(params.ruleTypes),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'set_period_status':
              return {
                ...params,
                period: params.period,
                status: params.periodStatus,
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'unmatch_auto_match_job':
              return {
                ...params,
                autoMatchJobId: parseOptionalNumberInput(
                  params.autoMatchJobId,
                  'Auto Match Job ID',
                  { integer: true, min: 0 }
                ),
                createReverseAdjustment: optionalBoolean(params.createReverseAdjustment),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'unmatch_transactions':
              return {
                ...params,
                matchTypeId: params.matchTypeId,
                matchIds: parseJson(params.matchIds, 'Match IDs'),
                forceReopen: optionalBoolean(params.forceReopen),
                waitForCompletion: optionalBoolean(params.waitForCompletion),
                maxWaitSeconds: parseOptionalNumberInput(
                  params.maxWaitSeconds,
                  'Max Wait Seconds',
                  { integer: true, min: 5, max: 300 }
                ),
              }
            case 'upload_file':
              return {
                ...params,
                file: normalizeFileInput(params.file, { single: true }),
                fileName: optionalString(params.outputFileName),
                extDirPath: optionalString(params.extDirPath),
              }
            default:
              throw new Error('Unsupported Account Reconciliation operation')
          }
        },
      },
    },
    inputs: {
      operation: {
        type: 'string',
        description: 'Account Reconciliation operation',
      },
      oauthCredential: {
        type: 'string',
        description: 'Oracle EPM service-account credential',
      },
      fileName: {
        type: 'string',
        description: 'Exact name of a file already uploaded to the Oracle EPM repository',
      },
      teamName: {
        type: 'string',
        description: 'Name of an existing Account Reconciliation team',
      },
      waitForCompletion: {
        type: 'boolean',
        description: 'Wait for the accepted job to finish (default false)',
      },
      maxWaitSeconds: {
        type: 'number',
        description: 'Maximum wait in seconds (5–300; default 60)',
      },
      matchTypeId: {
        type: 'string',
        description: 'Text ID of the Transaction Matching match type',
      },
      age: {
        type: 'number',
        description: 'Age in days of matched transactions to archive',
      },
      filterOperator: {
        type: 'string',
        description: 'Account ID filter operator; provide with filterValue',
      },
      filterValue: {
        type: 'json',
        description: 'Account ID filter values as a JSON string array',
      },
      logFileName: {
        type: 'string',
        description: 'Optional output log filename',
      },
      outputFileName: {
        type: 'string',
        description: 'Optional output archive ZIP filename',
      },
      period: {
        type: 'string',
        description: 'Reconciliation period name, not its internal ID',
      },
      filter: {
        type: 'string',
        description: 'Name of a public filter; omit to process all applicable objects',
      },
      accountId: {
        type: 'string',
        description: 'Account ID of the profile to delete',
      },
      referenceId: {
        type: 'string',
        description: 'FILE reference ID returned by List Reconciliation Comments',
      },
      format: {
        type: 'string',
        description: 'Report format',
      },
      jobId: {
        type: 'string',
        description: 'Compliance or Matching job ID; for purge, use the completed archive job ID',
      },
      dataLoadDefinition: {
        type: 'string',
        description: 'Name of the configured data-load definition',
      },
      transactionType: {
        type: 'string',
        description: 'BEX balance explanations, SRC/SUB adjustments, or VEX variance explanations',
      },
      dateFormat: {
        type: 'string',
        description: 'Date format used in the import file, for example MMM d, yyyy',
      },
      dataSource: {
        type: 'string',
        description: 'Text ID of the Transaction Matching data source',
      },
      balanceType: {
        type: 'string',
        description: 'SRC for source system or SUB for subsystem',
      },
      currencyBucket: {
        type: 'string',
        description: 'Configured currency bucket, for example Entered',
      },
      profileImportType: {
        type: 'string',
        description: 'Profile import method',
      },
      profileType: {
        type: 'string',
        description: 'Type of profile definitions',
      },
      rateType: {
        type: 'string',
        description: 'Currency rate type',
      },
      rateImportType: {
        type: 'string',
        description: 'Currency-rate import method',
      },
      rules: {
        type: 'string',
        description:
          'Comma-separated ALL, SET_ATTR_VAL, CRT_ALT, AUTO_APP, or AUTO_SUB; omit to run no rules',
      },
      reopen: {
        type: 'boolean',
        description: 'Reopen changed reconciliations after import',
      },
      periodStatusFilter: {
        type: 'string',
        description: 'Period status filter',
      },
      userlogin: {
        type: 'string',
        description: 'Filter by user login',
      },
      userattribute: {
        type: 'string',
        description: 'Case-insensitive search across user login, first name, last name, or email',
      },
      epmgroups: {
        type: 'boolean',
        description: 'Include EPM groups',
      },
      idcsgroups: {
        type: 'boolean',
        description: 'Include IDCS groups',
      },
      applicationroles: {
        type: 'boolean',
        description: 'Include application roles',
      },
      granularroles: {
        type: 'boolean',
        description: 'Include granular roles',
      },
      indirect: {
        type: 'boolean',
        description: 'Include both direct and indirect memberships',
      },
      filterName: {
        type: 'string',
        description: 'Name of a public reconciliation filter',
      },
      ruleTypes: {
        type: 'string',
        description:
          'Case-insensitive comma-separated rule types; omit to run all applicable rules',
      },
      periodStatus: {
        type: 'string',
        description: 'New period status',
      },
      autoMatchJobId: {
        type: 'number',
        description: 'ID of the auto-match or import-and-auto-match job',
      },
      createReverseAdjustment: {
        type: 'boolean',
        description: 'Create reverse adjustments for unmatched transactions',
      },
      matchIds: {
        type: 'json',
        description: 'JSON array of numeric match IDs (maximum 10,000)',
      },
      forceReopen: {
        type: 'boolean',
        description: 'Reopen affected reconciliations when required',
      },
      file: {
        type: 'file',
        description: 'Sim file to upload',
      },
      extDirPath: {
        type: 'string',
        description: 'Optional Data Management directory, such as inbox or inbox/data',
      },
    },
    outputs: {
      status: {
        type: 'number',
        description:
          'Oracle status: -1 pending job (Monitor: some reconciliations remain open), 0 success (Monitor: all closed), positive failure',
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'archive_matched_transactions',
            'create_reconciliations',
            'delete_file',
            'delete_profile',
            'export_user_details_report',
            'get_compliance_job_status',
            'get_matching_job_status',
            'import_balances',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'list_files',
            'list_periods',
            'list_users',
            'monitor_reconciliations',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'remove_users_from_team',
            'run_auto_alert',
            'run_auto_match',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
            'unmatch_auto_match_job',
            'unmatch_transactions',
            'upload_file',
          ],
        },
      },
      details: {
        type: 'string',
        description: 'Documented provider details; counts remain provider text',
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'archive_matched_transactions',
            'create_reconciliations',
            'delete_file',
            'delete_profile',
            'export_user_details_report',
            'get_compliance_job_status',
            'get_matching_job_status',
            'import_balances',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'list_files',
            'list_periods',
            'monitor_reconciliations',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'remove_users_from_team',
            'run_auto_alert',
            'run_auto_match',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
            'unmatch_auto_match_job',
            'unmatch_transactions',
            'upload_file',
          ],
        },
      },
      state: {
        type: 'string',
        description: 'Normalized job state: pending, succeeded, or failed',
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'archive_matched_transactions',
            'create_reconciliations',
            'delete_profile',
            'export_user_details_report',
            'get_compliance_job_status',
            'get_matching_job_status',
            'import_balances',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'remove_users_from_team',
            'run_auto_alert',
            'run_auto_match',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
            'unmatch_auto_match_job',
            'unmatch_transactions',
            'upload_file',
          ],
        },
      },
      jobId: {
        type: 'string',
        description: 'Job ID extracted from a validated provider status link',
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'archive_matched_transactions',
            'create_reconciliations',
            'delete_profile',
            'export_user_details_report',
            'get_compliance_job_status',
            'get_matching_job_status',
            'import_balances',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'remove_users_from_team',
            'run_auto_alert',
            'run_auto_match',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
            'unmatch_auto_match_job',
            'unmatch_transactions',
          ],
        },
      },
      accepted: {
        type: 'boolean',
        description: 'Whether Oracle accepted the launch; preserved if later work fails',
        condition: {
          field: 'operation',
          value: [
            'add_users_to_team',
            'archive_matched_transactions',
            'create_reconciliations',
            'delete_profile',
            'export_user_details_report',
            'import_balances',
            'import_compliance_transactions',
            'import_matching_transactions',
            'import_premapped_balances',
            'import_profiles',
            'import_rates',
            'import_reconciliation_attributes',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'remove_users_from_team',
            'run_auto_alert',
            'run_auto_match',
            'run_profile_rules',
            'run_reconciliation_rules',
            'set_period_status',
            'unmatch_auto_match_job',
            'unmatch_transactions',
          ],
        },
      },
      logFileName: {
        type: 'string',
        description: 'Repository log filename extracted from a validated log-content link',
        condition: {
          field: 'operation',
          value: [
            'archive_matched_transactions',
            'get_matching_job_status',
            'import_matching_transactions',
            'purge_archived_transactions',
            'purge_matched_transactions',
            'unmatch_transactions',
          ],
        },
      },
      archiveFileName: {
        type: 'string',
        description: 'Repository archive filename extracted from a validated file-content link',
        condition: {
          field: 'operation',
          value: ['archive_matched_transactions', 'get_matching_job_status'],
        },
      },
      fileName: {
        type: 'string',
        description: 'Exact repository or report filename',
        condition: {
          field: 'operation',
          value: ['delete_file', 'export_user_details_report', 'upload_file'],
        },
      },
      file: {
        type: 'file',
        description: 'Downloaded file stored in this Sim execution',
        condition: {
          field: 'operation',
          value: ['download_comment_attachment', 'download_file', 'export_user_details_report'],
        },
      },
      files: {
        type: 'json',
        description: 'Repository files and snapshots (name, type, size, lastmodifiedtime)',
        condition: {
          field: 'operation',
          value: ['list_files'],
        },
      },
      periods: {
        type: 'json',
        description: 'Periods matching the status filter (Id, Name, Status)',
        condition: {
          field: 'operation',
          value: ['list_periods'],
        },
      },
      comments: {
        type: 'json',
        description:
          'Reconciliation comments and attachment references (commentId, parentObjectId, commentText, postedBy, postedDate, references)',
        condition: {
          field: 'operation',
          value: ['list_reconciliation_comments'],
        },
      },
      users: {
        type: 'json',
        description:
          'Environment users with requested memberships (userlogin, firstname, lastname, email, epmgroups, idcsgroups, applicationroles, granularroles)',
        condition: {
          field: 'operation',
          value: ['list_users'],
        },
      },
      allClosed: {
        type: 'boolean',
        description:
          'True only when all filtered reconciliations are closed; -1 means some remain open',
        condition: {
          field: 'operation',
          value: ['monitor_reconciliations'],
        },
      },
      periodStatus: {
        type: 'string',
        description: 'Period status applied immediately, independently of the opening job',
        condition: {
          field: 'operation',
          value: ['set_period_status'],
        },
      },
    },
  }

export const OracleEpmAccountReconciliationBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/performance-management/account-reconciliation/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Prepare a reconciliation period',
      prompt:
        'Build a workflow that lists periods, selects a period by name, creates reconciliations using a configured public profile filter, waits for completion, and opens the period only after successful creation. Report the period change separately from its reconciliation-opening job.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Load period-end balances',
      prompt:
        'Build a workflow that uploads a balance CSV, imports pre-mapped balances for the selected period, balance type and currency bucket, and checks the compliance job result before any explicitly requested cleanup.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Automate transaction matching',
      prompt:
        'Create a workflow that uploads a transaction file, imports it into a configured match type and data source, waits for successful import, and then runs Auto Match. Preserve both job IDs and report failures without resubmitting mutations.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor reconciliation close',
      prompt:
        'Build a scheduled workflow that monitors reconciliations for a period and public filter, reports whether all are closed, and preserves Oracle details without interpreting open reconciliations as a pending job.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Collect reconciliation evidence',
      prompt:
        'Create a workflow that reads comments for a supplied period and account ID, lets the user select a FILE reference, and downloads that attachment into execution storage for review.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review user access',
      prompt:
        'Build a workflow that generates and downloads a CSV user-details report for Account Reconciliation. Return the report file and job status, and do not modify user access as part of the report.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Archive before approved purging',
      prompt:
        'Build a retention workflow that archives old matched transactions for a specified match type and account filter, checks the job, downloads the validated archive filename, and purges that archive job only after explicit approval and verification that the archive was retained.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
  ],
  skills: [
    {
      name: 'prepare-reconciliation-period',
      description: 'Create reconciliations and open their period in the correct order.',
      content:
        '# Prepare a reconciliation period\n\n## Steps\n\n1. List Periods and use the selected period name, not its internal ID.\n2. Create Reconciliations with the requested public profile filter and wait or check Get Compliance Job Status.\n3. After success, Set Period Status to open only if requested. Keep the period status separate from the opening job result.\n\n## Output\n\nReturn the period name and each accepted job ID. Do not automatically retry a mutation.\n\n[Oracle documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_create_reconciliation.html)',
    },
    {
      name: 'import-reconciliation-balances',
      description: 'Stage and import period balances using the configured balance contract.',
      content:
        '# Import reconciliation balances\n\n## Steps\n\n1. Upload File and retain its returned repository filename.\n2. Use Import Premapped Balances with that filename, period name, SRC or SUB, and the configured currency bucket.\n3. Wait for completion or use Get Compliance Job Status before downstream work.\n\n## Output\n\nReturn the job status and provider details. Delete staging files only when explicitly requested.\n\n[Oracle documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_import_pre_mapped_balances.html)',
    },
    {
      name: 'run-transaction-matching',
      description: 'Import transactions before running automatic matching.',
      content:
        '# Run transaction matching\n\n## Steps\n\n1. Upload the transaction file.\n2. Import Matching Transactions with the configured match type, data source and date format.\n3. Check successful import before Run Auto Match, then inspect Get Matching Job Status.\n\n## Output\n\nKeep both job IDs and report provider details. Do not infer match counts from text.\n\n[Oracle documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_tm_automatch.html)',
    },
    {
      name: 'monitor-reconciliation-close',
      description: 'Check whether the reconciliations selected by a public filter are closed.',
      content:
        '# Monitor reconciliation close\n\n## Steps\n\n1. Obtain the period name and an existing public reconciliation filter.\n2. Run Monitor Reconciliations.\n3. Treat status zero as all closed and minus one as some remaining open, not an asynchronous job.\n\n## Output\n\nReport allClosed and the provider details. Do not close or lock a period unless requested.\n\n[Oracle documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_monitor_reconciliations.html)',
    },
    {
      name: 'retrieve-reconciliation-evidence',
      description: 'Retrieve a selected file attachment from reconciliation comments.',
      content:
        '# Retrieve reconciliation evidence\n\n## Steps\n\n1. List Reconciliation Comments for the supplied period and account ID.\n2. Select a reference with type FILE and retain its reference ID.\n3. Download Comment Attachment using the same reconciliation scope and reference ID.\n\n## Output\n\nReturn the stored Sim file. URL references are not file downloads; the file limit is 100 MB.\n\n[Oracle documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_view_reconciliation_comments.html)',
    },
    {
      name: 'export-reconciliation-user-access',
      description: 'Produce a bounded user-details report for access review.',
      content:
        '# Export reconciliation user access\n\n## Steps\n\n1. Choose a report filename and CSV or XLS format.\n2. Run Export User Details Report; it starts, waits for and downloads the report within one budget.\n3. If the wait or download fails after acceptance, preserve the job ID and report the incomplete state.\n\n## Output\n\nReturn the report file on success. Reporting does not grant or remove roles.\n\n[Oracle documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/reports_arcs_generate_user_details_report.html)',
    },
    {
      name: 'archive-and-purge-matched-transactions',
      description: 'Retain matched transaction evidence before an explicitly authorized purge.',
      content:
        '# Archive and purge matched transactions\n\n## Steps\n\n1. Confirm the retention age, match type and any account filter.\n2. Archive Matched Transactions, check Get Matching Job Status, then Download File using the validated archive filename.\n3. Verify the archive is retained and obtain explicit approval before Purge Archived Transactions with the completed archive job ID.\n\n## Output\n\nReturn archive and purge job IDs separately. Purging is destructive and must never follow an unsuccessful archive download.\n\n[Oracle documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_archive_matched_transactions.html)',
    },
  ],
} as const satisfies BlockMeta
