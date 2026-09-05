import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { coerceFccsBoolean, coerceFccsJson, coerceFccsNumber } from '@/tools/oracle_epm_fccs/utils'

const operationFields: Record<string, string[]> = {
  oracle_epm_fccs_list_applications: [],
  oracle_epm_fccs_list_cubes: ['application'],
  oracle_epm_fccs_list_dimensions: ['application', 'cube', 'offset', 'limit', 'filter'],
  oracle_epm_fccs_get_dimension: ['application', 'cube', 'dimension', 'aliasTableName'],
  oracle_epm_fccs_get_member: ['application', 'dimension', 'member'],
  oracle_epm_fccs_add_member: ['application', 'dimension', 'member', 'parentName'],
  oracle_epm_fccs_validate_metadata: ['application', 'logFileName'],
  oracle_epm_fccs_list_job_definitions: ['application', 'jobType'],
  oracle_epm_fccs_execute_job: ['application', 'jobType', 'jobName', 'parameters'],
  oracle_epm_fccs_run_rule: ['application', 'rule', 'parameters'],
  oracle_epm_fccs_run_ruleset: ['application', 'ruleset', 'parameters'],
  oracle_epm_fccs_run_consolidation: [
    'application',
    'entity',
    'period',
    'scenario',
    'year',
    'force',
  ],
  oracle_epm_fccs_run_translation: ['application', 'entity', 'period', 'scenario', 'year', 'force'],
  oracle_epm_fccs_get_job: ['application', 'jobId'],
  oracle_epm_fccs_wait_for_job: ['application', 'jobId', 'maxWaitSeconds'],
  oracle_epm_fccs_get_job_details: [
    'application',
    'jobId',
    'detailJobType',
    'offset',
    'limit',
    'messageType',
  ],
  oracle_epm_fccs_get_child_job_details: [
    'application',
    'jobId',
    'childJobId',
    'childJobType',
    'offset',
    'limit',
    'messageType',
  ],
  oracle_epm_fccs_export_job_console: ['application', 'jobName', 'parameters'],
  oracle_epm_fccs_export_data_slice: ['application', 'cube', 'gridDefinition'],
  oracle_epm_fccs_import_data_slice: ['application', 'cube', 'dataGrid', 'aggregateEssbaseData'],
  oracle_epm_fccs_clear_data_slice: ['application', 'cube', 'gridDefinition'],
  oracle_epm_fccs_clear_data_profile: ['application', 'profileName'],
  oracle_epm_fccs_copy_data_profile: ['application', 'profileName'],
  oracle_epm_fccs_export_application_data: ['application', 'jobName', 'parameters'],
  oracle_epm_fccs_import_application_data: ['application', 'jobName', 'parameters'],
  oracle_epm_fccs_import_exchange_rates: ['application', 'jobName', 'parameters'],
  oracle_epm_fccs_export_metadata: ['application', 'jobName', 'parameters'],
  oracle_epm_fccs_import_metadata: ['application', 'jobName', 'parameters'],
  oracle_epm_fccs_list_journals: [
    'application',
    'scenario',
    'year',
    'period',
    'journalStatus',
    'consolidation',
    'group',
    'journalLabel',
    'description',
    'entity',
    'offset',
    'limit',
  ],
  oracle_epm_fccs_perform_journal_action: [
    'application',
    'journalLabel',
    'scenario',
    'year',
    'period',
    'journalAction',
    'consolidation',
  ],
  oracle_epm_fccs_update_journal_period: [
    'application',
    'scenario',
    'year',
    'period',
    'periodAction',
  ],
  oracle_epm_fccs_export_journals: ['application', 'fileName'],
  oracle_epm_fccs_import_journals: ['application', 'jobName', 'fileName', 'errorFileName'],
  oracle_epm_fccs_generate_intercompany_report: [
    'application',
    'jobName',
    'scenario',
    'year',
    'period',
    'reportFormat',
    'fileName',
  ],
  oracle_epm_fccs_export_consolidation_rulesets: ['application', 'rules'],
  oracle_epm_fccs_import_consolidation_rulesets: ['application', 'fileName'],
  oracle_epm_fccs_list_files: [],
  oracle_epm_fccs_upload_file: ['file', 'fileName', 'directory'],
  oracle_epm_fccs_download_file: ['fileName'],
  oracle_epm_fccs_delete_file: ['fileName'],
}
const configuredJobOperations = [
  'oracle_epm_fccs_execute_job',
  'oracle_epm_fccs_export_application_data',
  'oracle_epm_fccs_import_application_data',
  'oracle_epm_fccs_import_exchange_rates',
  'oracle_epm_fccs_export_metadata',
  'oracle_epm_fccs_import_metadata',
]
const repositoryFileOperations = [
  'oracle_epm_fccs_download_file',
  'oracle_epm_fccs_delete_file',
  'oracle_epm_fccs_import_consolidation_rulesets',
  'oracle_epm_fccs_import_journals',
]

/** Parameter coercion runs after variable resolution; selection itself remains pure. */
export function mapFccsBlockParams(params: Record<string, unknown>): Record<string, unknown> {
  const operation =
    typeof params.operation === 'string' ? params.operation : 'oracle_epm_fccs_list_applications'
  const values = { ...params }
  if (operation === 'oracle_epm_fccs_add_member') {
    values.member = params.newMemberName
    values.parentName = params.parentMember
  }
  if (operationFields[operation]?.includes('jobName'))
    values.jobName = configuredJobOperations.includes(operation)
      ? params.jobName
      : params.manualJobName
  if (repositoryFileOperations.includes(operation)) values.fileName = params.repositoryFile
  if (operation === 'oracle_epm_fccs_upload_file')
    values.file = normalizeFileInput(params.file, { single: true })
  for (const key of ['offset', 'limit', 'maxWaitSeconds'])
    values[key] = coerceFccsNumber(values[key])
  for (const key of ['force', 'aggregateEssbaseData']) values[key] = coerceFccsBoolean(values[key])
  for (const key of ['parameters', 'filter', 'gridDefinition', 'dataGrid', 'rules'])
    values[key] = coerceFccsJson(values[key])
  return {
    oauthCredential: params.oauthCredential,
    ...Object.fromEntries(
      (operationFields[operation] ?? []).map((key) => [
        key,
        values[key] === '' ? undefined : values[key],
      ])
    ),
  }
}

export const OracleEpmFccsBlock: BlockConfig<FccsResponse> = {
  type: 'oracle_epm_fccs',
  name: 'Oracle EPM FCCS',
  description: 'Consolidate and translate financial data, manage journals, and monitor FCCS jobs',
  longDescription:
    'Connect Financial Consolidation and Close using an Oracle EPM service account. Discover applications and metadata, run consolidation and translation rules, transfer data and journals, generate intercompany matching reports, and retrieve bounded repository files. Uses Cloud EPM APIs; excludes Fusion Financials, Data Integration, Planning workflows, environment administration, and LCM snapshots.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_fccs',
  category: 'tools',
  authMode: AuthMode.ApiKey,
  integrationType: IntegrationType.Commerce,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle EPM FCCS',
    sentences: {
      byOperation: {
        oracle_epm_fccs_list_applications: ['List applications'],
        oracle_epm_fccs_list_cubes: [
          {
            text: 'List cubes in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_list_dimensions: [
          {
            text: 'List dimensions in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_get_dimension: [
          {
            text: 'Get dimension in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_get_member: [
          {
            text: 'Get member in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_add_member: [
          {
            text: 'Add member in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_validate_metadata: [
          {
            text: 'Validate metadata in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_list_job_definitions: [
          {
            text: 'List job definitions in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_execute_job: [
          {
            text: 'Execute job in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_run_rule: [
          {
            text: 'Run rule in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_run_ruleset: [
          {
            text: 'Run ruleset in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_run_consolidation: [
          {
            text: 'Run consolidation in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_run_translation: [
          {
            text: 'Run translation in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_get_job: [
          {
            text: 'Get job in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_wait_for_job: [
          {
            text: 'Wait for job in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_get_job_details: [
          {
            text: 'Get job details in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_get_child_job_details: [
          {
            text: 'Get child job details in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_export_job_console: [
          {
            text: 'Export job console in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_export_data_slice: [
          {
            text: 'Export data slice in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_import_data_slice: [
          {
            text: 'Import data slice in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_clear_data_slice: [
          {
            text: 'Clear data slice in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_clear_data_profile: [
          {
            text: 'Clear data profile in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_copy_data_profile: [
          {
            text: 'Copy data profile in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_export_application_data: [
          {
            text: 'Export application data in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_import_application_data: [
          {
            text: 'Import application data in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_import_exchange_rates: [
          {
            text: 'Import exchange rates in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_export_metadata: [
          {
            text: 'Export metadata in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_import_metadata: [
          {
            text: 'Import metadata in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_list_journals: [
          {
            text: 'List journals in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_perform_journal_action: [
          {
            text: 'Perform journal action in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_update_journal_period: [
          {
            text: 'Update journal period in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_export_journals: [
          {
            text: 'Export journals in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_import_journals: [
          {
            text: 'Import journals in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_generate_intercompany_report: [
          {
            text: 'Generate intercompany report in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_export_consolidation_rulesets: [
          {
            text: 'Export consolidation rulesets in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_import_consolidation_rulesets: [
          {
            text: 'Import consolidation rulesets in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_fccs_list_files: ['List files'],
        oracle_epm_fccs_upload_file: ['Upload file'],
        oracle_epm_fccs_download_file: ['Download file'],
        oracle_epm_fccs_delete_file: ['Delete file'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { id: 'oracle_epm_fccs_list_applications', label: 'List applications' },
        { id: 'oracle_epm_fccs_list_cubes', label: 'List cubes' },
        { id: 'oracle_epm_fccs_list_dimensions', label: 'List dimensions' },
        { id: 'oracle_epm_fccs_get_dimension', label: 'Get dimension' },
        { id: 'oracle_epm_fccs_get_member', label: 'Get member' },
        { id: 'oracle_epm_fccs_add_member', label: 'Add member' },
        { id: 'oracle_epm_fccs_validate_metadata', label: 'Validate metadata' },
        { id: 'oracle_epm_fccs_list_job_definitions', label: 'List job definitions' },
        { id: 'oracle_epm_fccs_execute_job', label: 'Execute job' },
        { id: 'oracle_epm_fccs_run_rule', label: 'Run rule' },
        { id: 'oracle_epm_fccs_run_ruleset', label: 'Run ruleset' },
        { id: 'oracle_epm_fccs_run_consolidation', label: 'Run consolidation' },
        { id: 'oracle_epm_fccs_run_translation', label: 'Run translation' },
        { id: 'oracle_epm_fccs_get_job', label: 'Get job' },
        { id: 'oracle_epm_fccs_wait_for_job', label: 'Wait for job' },
        { id: 'oracle_epm_fccs_get_job_details', label: 'Get job details' },
        { id: 'oracle_epm_fccs_get_child_job_details', label: 'Get child job details' },
        { id: 'oracle_epm_fccs_export_job_console', label: 'Export job console' },
        { id: 'oracle_epm_fccs_export_data_slice', label: 'Export data slice' },
        { id: 'oracle_epm_fccs_import_data_slice', label: 'Import data slice' },
        { id: 'oracle_epm_fccs_clear_data_slice', label: 'Clear data slice' },
        { id: 'oracle_epm_fccs_clear_data_profile', label: 'Clear data profile' },
        { id: 'oracle_epm_fccs_copy_data_profile', label: 'Copy data profile' },
        { id: 'oracle_epm_fccs_export_application_data', label: 'Export application data' },
        { id: 'oracle_epm_fccs_import_application_data', label: 'Import application data' },
        { id: 'oracle_epm_fccs_import_exchange_rates', label: 'Import exchange rates' },
        { id: 'oracle_epm_fccs_export_metadata', label: 'Export metadata' },
        { id: 'oracle_epm_fccs_import_metadata', label: 'Import metadata' },
        { id: 'oracle_epm_fccs_list_journals', label: 'List journals' },
        { id: 'oracle_epm_fccs_perform_journal_action', label: 'Perform journal action' },
        { id: 'oracle_epm_fccs_update_journal_period', label: 'Update journal period' },
        { id: 'oracle_epm_fccs_export_journals', label: 'Export journals' },
        { id: 'oracle_epm_fccs_import_journals', label: 'Import journals' },
        {
          id: 'oracle_epm_fccs_generate_intercompany_report',
          label: 'Generate intercompany report',
        },
        {
          id: 'oracle_epm_fccs_export_consolidation_rulesets',
          label: 'Export consolidation rulesets',
        },
        {
          id: 'oracle_epm_fccs_import_consolidation_rulesets',
          label: 'Import consolidation rulesets',
        },
        { id: 'oracle_epm_fccs_list_files', label: 'List files' },
        { id: 'oracle_epm_fccs_upload_file', label: 'Upload file' },
        { id: 'oracle_epm_fccs_download_file', label: 'Download file' },
        { id: 'oracle_epm_fccs_delete_file', label: 'Delete file' },
      ],
      value: () => 'oracle_epm_fccs_list_applications',
    },
    {
      id: 'credential',
      title: 'Service account',
      type: 'oauth-input',
      serviceId: 'oracle-epm-fccs',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      requiredScopes: getScopesForService('oracle-epm-fccs'),
      placeholder: 'Select Oracle EPM credential',
    },
    {
      id: 'credentialManual',
      title: 'Service account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Credential ID',
    },
    {
      id: 'applicationSelector',
      title: 'Application',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.applications',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'application',
      mode: 'basic',
      dependsOn: ['oauthCredential'],
      placeholder: 'Choose application; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_cubes',
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
          'oracle_epm_fccs_validate_metadata',
          'oracle_epm_fccs_list_job_definitions',
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
          'oracle_epm_fccs_export_consolidation_rulesets',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_cubes',
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
          'oracle_epm_fccs_validate_metadata',
          'oracle_epm_fccs_list_job_definitions',
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
          'oracle_epm_fccs_export_consolidation_rulesets',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
    },
    {
      id: 'applicationManual',
      title: 'Application',
      type: 'short-input',
      canonicalParamId: 'application',
      mode: 'advanced',
      placeholder: 'Exact FCCS application name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_cubes',
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
          'oracle_epm_fccs_validate_metadata',
          'oracle_epm_fccs_list_job_definitions',
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
          'oracle_epm_fccs_export_consolidation_rulesets',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_cubes',
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
          'oracle_epm_fccs_validate_metadata',
          'oracle_epm_fccs_list_job_definitions',
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
          'oracle_epm_fccs_export_consolidation_rulesets',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
    },
    {
      id: 'cubeSelector',
      title: 'Cube',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.cubes',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'cube',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application'],
      placeholder: 'Choose cube (also enables member pickers)',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
        ],
      },
    },
    {
      id: 'cubeManual',
      title: 'Cube',
      type: 'short-input',
      canonicalParamId: 'cube',
      mode: 'advanced',
      placeholder: 'Cube planTypeName from List Cubes',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_export_data_slice',
          'oracle_epm_fccs_import_data_slice',
          'oracle_epm_fccs_clear_data_slice',
        ],
      },
    },
    {
      id: 'dimensionSelector',
      title: 'Dimension',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.dimensions',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'dimension',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application', 'cube'],
      placeholder: 'Choose dimension; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
        ],
      },
    },
    {
      id: 'dimensionManual',
      title: 'Dimension',
      type: 'short-input',
      canonicalParamId: 'dimension',
      mode: 'advanced',
      placeholder: 'Exact dimension name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
        ],
      },
    },
    {
      id: 'memberSelector',
      title: 'Member',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.members',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'member',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application', 'cube', 'dimension'],
      placeholder: 'Choose member; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member'],
      },
    },
    {
      id: 'memberManual',
      title: 'Member',
      type: 'short-input',
      canonicalParamId: 'member',
      mode: 'advanced',
      placeholder: 'Exact member name; for Add Member, the new dynamic child name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member'],
      },
    },
    {
      id: 'parentNameSelector',
      title: 'Parent Name',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.members',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'parentMember',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application', 'cube', 'dimension'],
      placeholder: 'Choose parent name; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_add_member'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_add_member'],
      },
    },
    {
      id: 'parentNameManual',
      title: 'Parent Name',
      type: 'short-input',
      canonicalParamId: 'parentMember',
      mode: 'advanced',
      placeholder: 'Parent enabled for dynamic children after a cube refresh',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_add_member'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_add_member'],
      },
    },
    {
      id: 'aliasTableName',
      title: 'Alias Table Name',
      type: 'short-input',
      placeholder: 'Alias table name for hierarchy labels',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_dimension'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Zero-based starting record index',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_list_journals',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size, 1–1000 (default 25); requests one page only',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_list_journals',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'code',
      placeholder: 'Documented dimension query object (for example {"dimType":"Entity"})',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_dimensions'],
      },
      required: false,
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Documented dimension query object (for example {"dimType":"Entity"}). Return only JSON.',
        generationType: 'json-object',
      },
    },
    {
      id: 'logFileName',
      title: 'Log File Name',
      type: 'short-input',
      placeholder: 'Validation log filename; sent in the documented resource query',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_validate_metadata'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'jobType',
      title: 'Job Type',
      type: 'dropdown',
      placeholder:
        'FCCS job family: RULES, RULESET, IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, EXPORT_METADATA, IMPORT_EXCHANGE_RATES, JOBCONSOLE_EXPORT, Clear_Data, Copy_Data, IMPORT_JOURNAL, EXPORT_JOURNAL, GENERATE_INTERCOMPANY_REPORT',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_job_definitions', 'oracle_epm_fccs_execute_job'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_execute_job'],
      },
      options: [
        {
          id: 'RULES',
          label: 'RULES',
        },
        {
          id: 'RULESET',
          label: 'RULESET',
        },
        {
          id: 'IMPORT_DATA',
          label: 'IMPORT_DATA',
        },
        {
          id: 'EXPORT_DATA',
          label: 'EXPORT_DATA',
        },
        {
          id: 'IMPORT_METADATA',
          label: 'IMPORT_METADATA',
        },
        {
          id: 'EXPORT_METADATA',
          label: 'EXPORT_METADATA',
        },
        {
          id: 'IMPORT_EXCHANGE_RATES',
          label: 'IMPORT_EXCHANGE_RATES',
        },
        {
          id: 'JOBCONSOLE_EXPORT',
          label: 'JOBCONSOLE_EXPORT',
        },
        {
          id: 'Clear_Data',
          label: 'Clear_Data',
        },
        {
          id: 'Copy_Data',
          label: 'Copy_Data',
        },
        {
          id: 'IMPORT_JOURNAL',
          label: 'IMPORT_JOURNAL',
        },
        {
          id: 'EXPORT_JOURNAL',
          label: 'EXPORT_JOURNAL',
        },
        {
          id: 'GENERATE_INTERCOMPANY_REPORT',
          label: 'GENERATE_INTERCOMPANY_REPORT',
        },
      ],
    },
    {
      id: 'jobNameSelector',
      title: 'Job Name',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.jobDefinitions',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'jobName',
      mode: 'basic',
      dependsOn: {
        all: ['oauthCredential', 'application'],
        any: ['operation', 'jobType'],
      },
      placeholder: 'Choose job name; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
        ],
      },
    },
    {
      id: 'jobNameManual',
      title: 'Job Name',
      type: 'short-input',
      canonicalParamId: 'jobName',
      mode: 'advanced',
      placeholder:
        'Exact saved job or report definition name; definitions and required overrides depend on the tenant',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
        ],
      },
    },
    {
      id: 'parameters',
      title: 'Parameters',
      type: 'code',
      placeholder:
        'Case-sensitive documented job overrides or tenant-defined rule runtime prompts as a JSON object',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
        ],
      },
      required: false,
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Case-sensitive documented job overrides or tenant-defined rule runtime prompts as a JSON object. Return only JSON.',
        generationType: 'json-object',
      },
    },
    {
      id: 'ruleSelector',
      title: 'Rule',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.rules',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'rule',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application'],
      placeholder: 'Choose rule; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_rule'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_rule'],
      },
    },
    {
      id: 'ruleManual',
      title: 'Rule',
      type: 'short-input',
      canonicalParamId: 'rule',
      mode: 'advanced',
      placeholder: 'Exact deployed business rule name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_rule'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_rule'],
      },
    },
    {
      id: 'rulesetSelector',
      title: 'Ruleset',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.ruleSets',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'ruleset',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application'],
      placeholder: 'Choose ruleset; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_ruleset'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_ruleset'],
      },
    },
    {
      id: 'rulesetManual',
      title: 'Ruleset',
      type: 'short-input',
      canonicalParamId: 'ruleset',
      mode: 'advanced',
      placeholder: 'Exact deployed business ruleset name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_ruleset'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_ruleset'],
      },
    },
    {
      id: 'entitySelector',
      title: 'Entity',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.entities',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'entity',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application', 'cube'],
      placeholder: 'Choose entity; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_consolidation', 'oracle_epm_fccs_run_translation'],
      },
    },
    {
      id: 'entityManual',
      title: 'Entity',
      type: 'short-input',
      canonicalParamId: 'entity',
      mode: 'advanced',
      placeholder: 'Entity member or rule-supported member selection expression',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_consolidation', 'oracle_epm_fccs_run_translation'],
      },
    },
    {
      id: 'periodSelector',
      title: 'Period',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.periods',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'period',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application', 'cube'],
      placeholder: 'Choose period; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
        ],
      },
    },
    {
      id: 'periodManual',
      title: 'Period',
      type: 'short-input',
      canonicalParamId: 'period',
      mode: 'advanced',
      placeholder: 'Period member',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
        ],
      },
    },
    {
      id: 'scenarioSelector',
      title: 'Scenario',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.scenarios',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'scenario',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application', 'cube'],
      placeholder: 'Choose scenario; use Advanced for manual input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
        ],
      },
    },
    {
      id: 'scenarioManual',
      title: 'Scenario',
      type: 'short-input',
      canonicalParamId: 'scenario',
      mode: 'advanced',
      placeholder: 'Scenario member',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
        ],
      },
    },
    {
      id: 'year',
      title: 'Year',
      type: 'short-input',
      placeholder: 'Year member, such as FY26',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_perform_journal_action',
          'oracle_epm_fccs_update_journal_period',
        ],
      },
    },
    {
      id: 'force',
      title: 'Force',
      type: 'switch',
      placeholder:
        'Use ForceConsolidate or ForceTranslate (default false); requires applicable Oracle permissions',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_run_consolidation', 'oracle_epm_fccs_run_translation'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'jobId',
      title: 'Job Id',
      type: 'short-input',
      placeholder: 'Execution job ID from submission output; not a saved job definition ID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
        ],
      },
    },
    {
      id: 'childJobId',
      title: 'Child Job Id',
      type: 'short-input',
      placeholder: 'Child job ID from Get Job Details',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_child_job_details'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_child_job_details'],
      },
    },
    {
      id: 'maxWaitSeconds',
      title: 'Max Wait Seconds',
      type: 'short-input',
      placeholder:
        'Maximum wait in seconds, 1–86400 (default 300), also bounded by the workflow deadline',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_wait_for_job'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'detailJobType',
      title: 'Detail Job Type',
      type: 'dropdown',
      placeholder:
        'Original job family: IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, or EXPORT_METADATA',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_job_details'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_job_details'],
      },
      options: [
        {
          id: 'IMPORT_DATA',
          label: 'IMPORT_DATA',
        },
        {
          id: 'EXPORT_DATA',
          label: 'EXPORT_DATA',
        },
        {
          id: 'IMPORT_METADATA',
          label: 'IMPORT_METADATA',
        },
        {
          id: 'EXPORT_METADATA',
          label: 'EXPORT_METADATA',
        },
      ],
    },
    {
      id: 'childJobType',
      title: 'Child Job Type',
      type: 'dropdown',
      placeholder: 'Original job family: IMPORT_METADATA or EXPORT_METADATA',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_child_job_details'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_child_job_details'],
      },
      options: [
        {
          id: 'IMPORT_METADATA',
          label: 'IMPORT_METADATA',
        },
        {
          id: 'EXPORT_METADATA',
          label: 'EXPORT_METADATA',
        },
      ],
    },
    {
      id: 'messageType',
      title: 'Message Type',
      type: 'dropdown',
      placeholder: 'Optional message filter: ERROR, WARNING, or INFO',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_job_details', 'oracle_epm_fccs_get_child_job_details'],
      },
      required: false,
      mode: 'advanced',
      options: [
        {
          id: 'ERROR',
          label: 'ERROR',
        },
        {
          id: 'WARNING',
          label: 'WARNING',
        },
        {
          id: 'INFO',
          label: 'INFO',
        },
      ],
    },
    {
      id: 'gridDefinition',
      title: 'Grid Definition',
      type: 'code',
      placeholder:
        'Essbase region: pov {dimensions?,members:string[][]}, columns/rows arrays of the same axes; optional suppressMissingBlocks/Rows/Columns',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_data_slice', 'oracle_epm_fccs_clear_data_slice'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_data_slice', 'oracle_epm_fccs_clear_data_slice'],
      },
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Essbase region: pov {dimensions?,members:string[][]}, columns/rows arrays of the same axes; optional suppressMissingBlocks/Rows/Columns. Return only JSON.',
        generationType: 'json-object',
      },
    },
    {
      id: 'dataGrid',
      title: 'Data Grid',
      type: 'code',
      placeholder:
        'Numeric Essbase grid: pov:string[], columns:string[][], rows:{headers:string[],data:(number|numeric string|"#missing")[]}[]',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice'],
      },
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Numeric Essbase grid: pov:string[], columns:string[][], rows:{headers:string[],data:(number|numeric string|"#missing")[]}[]. Return only JSON.',
        generationType: 'json-object',
      },
    },
    {
      id: 'aggregateEssbaseData',
      title: 'Aggregate Essbase Data',
      type: 'switch',
      placeholder: 'Add to existing values instead of overwriting (default false)',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'profileName',
      title: 'Profile Name',
      type: 'short-input',
      placeholder:
        'Existing FCCS Clear Data or Copy Data profile name; no listing API is documented',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_clear_data_profile', 'oracle_epm_fccs_copy_data_profile'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_clear_data_profile', 'oracle_epm_fccs_copy_data_profile'],
      },
    },
    {
      id: 'journalStatus',
      title: 'Journal Status',
      type: 'dropdown',
      placeholder: 'WORKING, SUBMITTED, POSTED, or APPROVED',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals'],
      },
      options: [
        {
          id: 'WORKING',
          label: 'WORKING',
        },
        {
          id: 'SUBMITTED',
          label: 'SUBMITTED',
        },
        {
          id: 'POSTED',
          label: 'POSTED',
        },
        {
          id: 'APPROVED',
          label: 'APPROVED',
        },
      ],
    },
    {
      id: 'consolidation',
      title: 'Consolidation',
      type: 'short-input',
      placeholder: 'Journal consolidation member, such as FCCS_Entity Input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals', 'oracle_epm_fccs_perform_journal_action'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'group',
      title: 'Group',
      type: 'short-input',
      placeholder: 'Journal group filter',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'journalLabel',
      title: 'Journal Label',
      type: 'short-input',
      placeholder: 'Journal label',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals', 'oracle_epm_fccs_perform_journal_action'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_perform_journal_action'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Journal description filter',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'journalAction',
      title: 'Journal Action',
      type: 'dropdown',
      placeholder: 'SUBMIT, APPROVE, POST, UNPOST, or REJECT',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_perform_journal_action'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_perform_journal_action'],
      },
      options: [
        {
          id: 'SUBMIT',
          label: 'SUBMIT',
        },
        {
          id: 'APPROVE',
          label: 'APPROVE',
        },
        {
          id: 'POST',
          label: 'POST',
        },
        {
          id: 'UNPOST',
          label: 'UNPOST',
        },
        {
          id: 'REJECT',
          label: 'REJECT',
        },
      ],
    },
    {
      id: 'periodAction',
      title: 'Period Action',
      type: 'dropdown',
      placeholder: 'OPEN or CLOSE',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_update_journal_period'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_update_journal_period'],
      },
      options: [
        {
          id: 'OPEN',
          label: 'OPEN',
        },
        {
          id: 'CLOSE',
          label: 'CLOSE',
        },
      ],
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder:
        'Exact repository filename/path; do not URL encode it. Upload requires a basename',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_generate_intercompany_report',
          'oracle_epm_fccs_upload_file',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_journals', 'oracle_epm_fccs_upload_file'],
      },
    },
    {
      id: 'errorFileName',
      title: 'Error File Name',
      type: 'short-input',
      placeholder: 'Repository filename for journal import diagnostics',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_journals'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'reportFormat',
      title: 'Report Format',
      type: 'short-input',
      placeholder: 'Format accepted by the saved intercompany report (for example HTML)',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_generate_intercompany_report'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'rules',
      title: 'Rules',
      type: 'code',
      placeholder:
        'Configurable-consolidation ruleset names to export; distinct from Calculation Manager rulesets',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_consolidation_rulesets'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_consolidation_rulesets'],
      },
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Configurable-consolidation ruleset names to export; distinct from Calculation Manager rulesets. Return ONLY a JSON array of exact ruleset names.',
        generationType: 'json-array',
      },
    },
    {
      id: 'directory',
      title: 'Directory',
      type: 'short-input',
      placeholder:
        'Optional inbox or outbox directory; subdirectories supported. Omit for the default repository',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_upload_file'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'newMemberName',
      title: 'New member name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_add_member'],
      },
      required: true,
    },
    {
      id: 'manualJobName',
      title: 'Job name',
      type: 'short-input',
      placeholder:
        'Saved journal import / intercompany report definition, or job console export label',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_journals', 'oracle_epm_fccs_generate_intercompany_report'],
      },
    },
    {
      id: 'repositoryFileSelector',
      title: 'Repository file',
      type: 'combobox',
      selectorKey: 'oracleEpmFccs.files',
      serviceId: 'oracle-epm-fccs',
      canonicalParamId: 'repositoryFile',
      mode: 'basic',
      dependsOn: ['oauthCredential'],
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_download_file',
          'oracle_epm_fccs_delete_file',
          'oracle_epm_fccs_import_consolidation_rulesets',
          'oracle_epm_fccs_import_journals',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_download_file',
          'oracle_epm_fccs_delete_file',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
      placeholder: 'Select an external repository file',
    },
    {
      id: 'repositoryFileManual',
      title: 'Repository file',
      type: 'short-input',
      canonicalParamId: 'repositoryFile',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_download_file',
          'oracle_epm_fccs_delete_file',
          'oracle_epm_fccs_import_consolidation_rulesets',
          'oracle_epm_fccs_import_journals',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_download_file',
          'oracle_epm_fccs_delete_file',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
      placeholder: 'Exact filename/path; do not URL encode',
    },
    {
      id: 'sourceFileUpload',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      multiple: false,
      mode: 'basic',
      maxSize: 100,
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_upload_file'],
      },
      required: true,
    },
    {
      id: 'sourceFileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_upload_file'],
      },
      required: true,
      placeholder: 'Reference one uploaded Sim UserFile',
    },
  ],
  tools: {
    access: [
      'oracle_epm_fccs_list_applications',
      'oracle_epm_fccs_list_cubes',
      'oracle_epm_fccs_list_dimensions',
      'oracle_epm_fccs_get_dimension',
      'oracle_epm_fccs_get_member',
      'oracle_epm_fccs_add_member',
      'oracle_epm_fccs_validate_metadata',
      'oracle_epm_fccs_list_job_definitions',
      'oracle_epm_fccs_execute_job',
      'oracle_epm_fccs_run_rule',
      'oracle_epm_fccs_run_ruleset',
      'oracle_epm_fccs_run_consolidation',
      'oracle_epm_fccs_run_translation',
      'oracle_epm_fccs_get_job',
      'oracle_epm_fccs_wait_for_job',
      'oracle_epm_fccs_get_job_details',
      'oracle_epm_fccs_get_child_job_details',
      'oracle_epm_fccs_export_job_console',
      'oracle_epm_fccs_export_data_slice',
      'oracle_epm_fccs_import_data_slice',
      'oracle_epm_fccs_clear_data_slice',
      'oracle_epm_fccs_clear_data_profile',
      'oracle_epm_fccs_copy_data_profile',
      'oracle_epm_fccs_export_application_data',
      'oracle_epm_fccs_import_application_data',
      'oracle_epm_fccs_import_exchange_rates',
      'oracle_epm_fccs_export_metadata',
      'oracle_epm_fccs_import_metadata',
      'oracle_epm_fccs_list_journals',
      'oracle_epm_fccs_perform_journal_action',
      'oracle_epm_fccs_update_journal_period',
      'oracle_epm_fccs_export_journals',
      'oracle_epm_fccs_import_journals',
      'oracle_epm_fccs_generate_intercompany_report',
      'oracle_epm_fccs_export_consolidation_rulesets',
      'oracle_epm_fccs_import_consolidation_rulesets',
      'oracle_epm_fccs_list_files',
      'oracle_epm_fccs_upload_file',
      'oracle_epm_fccs_download_file',
      'oracle_epm_fccs_delete_file',
    ],
    config: {
      tool: (params) =>
        typeof params.operation === 'string'
          ? params.operation
          : 'oracle_epm_fccs_list_applications',
      params: mapFccsBlockParams,
    },
  },
  inputs: {
    oauthCredential: {
      type: 'string',
      description: 'Oracle EPM service account credential',
    },
    application: {
      type: 'string',
      description: 'Exact FCCS application name',
    },
    cube: {
      type: 'string',
      description: 'Cube planTypeName from List Cubes',
    },
    dimension: {
      type: 'string',
      description: 'Exact dimension name',
    },
    member: {
      type: 'string',
      description: 'Exact member name; for Add Member, the new dynamic child name',
    },
    parentName: {
      type: 'string',
      description: 'Parent enabled for dynamic children after a cube refresh',
    },
    aliasTableName: {
      type: 'string',
      description: 'Alias table name for hierarchy labels',
    },
    offset: {
      type: 'number',
      description: 'Zero-based starting record index',
    },
    limit: {
      type: 'number',
      description: 'Page size, 1–1000 (default 25); requests one page only',
    },
    filter: {
      type: 'json',
      description: 'Documented dimension query object (for example {"dimType":"Entity"})',
    },
    logFileName: {
      type: 'string',
      description: 'Validation log filename; sent in the documented resource query',
    },
    jobType: {
      type: 'string',
      description:
        'FCCS job family: RULES, RULESET, IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, EXPORT_METADATA, IMPORT_EXCHANGE_RATES, JOBCONSOLE_EXPORT, Clear_Data, Copy_Data, IMPORT_JOURNAL, EXPORT_JOURNAL, GENERATE_INTERCOMPANY_REPORT',
    },
    jobName: {
      type: 'string',
      description:
        'Exact saved job or report definition name; definitions and required overrides depend on the tenant',
    },
    parameters: {
      type: 'json',
      description:
        'Case-sensitive documented job overrides or tenant-defined rule runtime prompts as a JSON object',
    },
    rule: {
      type: 'string',
      description: 'Exact deployed business rule name',
    },
    ruleset: {
      type: 'string',
      description: 'Exact deployed business ruleset name',
    },
    entity: {
      type: 'string',
      description: 'Entity member or rule-supported member selection expression',
    },
    period: {
      type: 'string',
      description: 'Period member',
    },
    scenario: {
      type: 'string',
      description: 'Scenario member',
    },
    year: {
      type: 'string',
      description: 'Year member, such as FY26',
    },
    force: {
      type: 'boolean',
      description:
        'Use ForceConsolidate or ForceTranslate (default false); requires applicable Oracle permissions',
    },
    jobId: {
      type: 'string',
      description: 'Execution job ID from submission output; not a saved job definition ID',
    },
    childJobId: {
      type: 'string',
      description: 'Child job ID from Get Job Details',
    },
    maxWaitSeconds: {
      type: 'number',
      description:
        'Maximum wait in seconds, 1–86400 (default 300), also bounded by the workflow deadline',
    },
    detailJobType: {
      type: 'string',
      description:
        'Original job family: IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, or EXPORT_METADATA',
    },
    childJobType: {
      type: 'string',
      description: 'Original job family: IMPORT_METADATA or EXPORT_METADATA',
    },
    messageType: {
      type: 'string',
      description: 'Optional message filter: ERROR, WARNING, or INFO',
    },
    gridDefinition: {
      type: 'json',
      description:
        'Essbase region: pov {dimensions?,members:string[][]}, columns/rows arrays of the same axes; optional suppressMissingBlocks/Rows/Columns',
    },
    dataGrid: {
      type: 'json',
      description:
        'Numeric Essbase grid: pov:string[], columns:string[][], rows:{headers:string[],data:(number|numeric string|"#missing")[]}[]',
    },
    aggregateEssbaseData: {
      type: 'boolean',
      description: 'Add to existing values instead of overwriting (default false)',
    },
    profileName: {
      type: 'string',
      description:
        'Existing FCCS Clear Data or Copy Data profile name; no listing API is documented',
    },
    journalStatus: {
      type: 'string',
      description: 'WORKING, SUBMITTED, POSTED, or APPROVED',
    },
    consolidation: {
      type: 'string',
      description: 'Journal consolidation member, such as FCCS_Entity Input',
    },
    group: {
      type: 'string',
      description: 'Journal group filter',
    },
    journalLabel: {
      type: 'string',
      description: 'Journal label',
    },
    description: {
      type: 'string',
      description: 'Journal description filter',
    },
    journalAction: {
      type: 'string',
      description: 'SUBMIT, APPROVE, POST, UNPOST, or REJECT',
    },
    periodAction: {
      type: 'string',
      description: 'OPEN or CLOSE',
    },
    fileName: {
      type: 'string',
      description:
        'Exact repository filename/path; do not URL encode it. Upload requires a basename',
    },
    errorFileName: {
      type: 'string',
      description: 'Repository filename for journal import diagnostics',
    },
    reportFormat: {
      type: 'string',
      description: 'Format accepted by the saved intercompany report (for example HTML)',
    },
    rules: {
      type: 'json',
      description:
        'Configurable-consolidation ruleset names to export; distinct from Calculation Manager rulesets',
    },
    file: {
      type: 'json',
      description: 'One authorized Sim UserFile to upload, no larger than 100 MiB',
    },
    directory: {
      type: 'string',
      description:
        'Optional inbox or outbox directory; subdirectories supported. Omit for the default repository',
    },
    parentMember: {
      type: 'string',
      description: 'Dynamic parent member',
    },
    repositoryFile: {
      type: 'string',
      description: 'Existing external repository file',
    },
    manualJobName: {
      type: 'string',
      description: 'Journal/report job name or console label',
    },
    newMemberName: {
      type: 'string',
      description: 'New dynamic member name',
    },
  },
  outputs: {
    items: {
      type: 'array',
      description:
        'Documented application, cube, dimension, job definition, diagnostic, journal-header, or repository-file records for the selected action',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_applications',
          'oracle_epm_fccs_list_cubes',
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_list_job_definitions',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_list_journals',
          'oracle_epm_fccs_list_files',
        ],
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total matching dimensions',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_dimensions', 'oracle_epm_fccs_list_journals'],
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'More pages exist',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_list_dimensions',
          'oracle_epm_fccs_get_job_details',
          'oracle_epm_fccs_get_child_job_details',
          'oracle_epm_fccs_list_journals',
        ],
      },
    },
    name: {
      type: 'string',
      description: 'Dimension name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_get_dimension',
          'oracle_epm_fccs_get_member',
          'oracle_epm_fccs_add_member',
        ],
      },
    },
    id: {
      type: 'string',
      description: 'Dimension ID',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_dimension'],
      },
    },
    path: {
      type: 'string',
      description: 'Hierarchy path',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_dimension'],
      },
    },
    alias: {
      type: 'string',
      description: 'Alias',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_dimension'],
      },
    },
    children: {
      type: 'array',
      description: 'Recursive child hierarchy; bounded to 10,000 nodes and 64 levels',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_dimension'],
      },
    },
    description: {
      type: 'string',
      description: 'description',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member', 'oracle_epm_fccs_add_member'],
      },
    },
    parentName: {
      type: 'string',
      description: 'parentName',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member', 'oracle_epm_fccs_add_member'],
      },
    },
    dataType: {
      type: 'string',
      description: 'dataType',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member', 'oracle_epm_fccs_add_member'],
      },
    },
    dataStorage: {
      type: 'string',
      description: 'dataStorage',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member', 'oracle_epm_fccs_add_member'],
      },
    },
    dimName: {
      type: 'string',
      description: 'dimName',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member', 'oracle_epm_fccs_add_member'],
      },
    },
    objectType: {
      type: 'number',
      description: 'Oracle object type code',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member', 'oracle_epm_fccs_add_member'],
      },
    },
    twoPass: {
      type: 'boolean',
      description: 'Two-pass calculation attribute',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_member', 'oracle_epm_fccs_add_member'],
      },
    },
    numWarnings: {
      type: 'number',
      description: 'numWarnings',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_validate_metadata'],
      },
    },
    numInfo: {
      type: 'number',
      description: 'numInfo',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_validate_metadata'],
      },
    },
    numErrors: {
      type: 'number',
      description: 'numErrors',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_validate_metadata'],
      },
    },
    outPutFileName: {
      type: 'string',
      description: 'CSV validation report name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_validate_metadata'],
      },
    },
    status: {
      type: 'json',
      description: 'Numeric Oracle job/file status, or metadata validation status text',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_validate_metadata',
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
          'oracle_epm_fccs_list_files',
          'oracle_epm_fccs_upload_file',
          'oracle_epm_fccs_delete_file',
        ],
      },
    },
    jobId: {
      type: 'string',
      description: 'Execution job ID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
    },
    details: {
      type: 'string',
      description: 'Job status details',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
          'oracle_epm_fccs_list_files',
          'oracle_epm_fccs_upload_file',
          'oracle_epm_fccs_delete_file',
        ],
      },
    },
    jobName: {
      type: 'string',
      description: 'Job name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
    },
    descriptiveStatus: {
      type: 'string',
      description: 'Job status label',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
    },
    detailedStatus: {
      type: 'number',
      description: 'Granular status code',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_execute_job',
          'oracle_epm_fccs_run_rule',
          'oracle_epm_fccs_run_ruleset',
          'oracle_epm_fccs_run_consolidation',
          'oracle_epm_fccs_run_translation',
          'oracle_epm_fccs_get_job',
          'oracle_epm_fccs_wait_for_job',
          'oracle_epm_fccs_export_job_console',
          'oracle_epm_fccs_clear_data_profile',
          'oracle_epm_fccs_copy_data_profile',
          'oracle_epm_fccs_export_application_data',
          'oracle_epm_fccs_import_application_data',
          'oracle_epm_fccs_import_exchange_rates',
          'oracle_epm_fccs_export_metadata',
          'oracle_epm_fccs_import_metadata',
          'oracle_epm_fccs_export_journals',
          'oracle_epm_fccs_import_journals',
          'oracle_epm_fccs_generate_intercompany_report',
        ],
      },
    },
    attempts: {
      type: 'number',
      description: 'Status reads',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_wait_for_job'],
      },
    },
    nextOffset: {
      type: 'number',
      description: 'Next page offset from that link',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_get_job_details', 'oracle_epm_fccs_get_child_job_details'],
      },
    },
    pov: {
      type: 'array',
      description: 'Point-of-view members',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_data_slice'],
      },
    },
    columns: {
      type: 'array',
      description: 'Column member arrays',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_data_slice'],
      },
    },
    rows: {
      type: 'array',
      description: 'Exported data rows',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_export_data_slice'],
      },
    },
    numAcceptedCells: {
      type: 'number',
      description: 'Cells accepted',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice'],
      },
    },
    numUpdateCells: {
      type: 'number',
      description: 'Cells actually updated',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice'],
      },
    },
    numRejectedCells: {
      type: 'number',
      description: 'Cells rejected',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice', 'oracle_epm_fccs_clear_data_slice'],
      },
    },
    rejectedCells: {
      type: 'array',
      description: 'First rejected cell coordinates (Oracle maximum 100)',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice', 'oracle_epm_fccs_clear_data_slice'],
      },
    },
    rejectedCellsWithDetails: {
      type: 'array',
      description: 'Rejection reasons',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_import_data_slice'],
      },
    },
    numClearedCells: {
      type: 'number',
      description: 'Cells cleared',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_clear_data_slice'],
      },
    },
    count: {
      type: 'number',
      description: 'Items in this page',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals'],
      },
    },
    limit: {
      type: 'number',
      description: 'Page size',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals'],
      },
    },
    offset: {
      type: 'number',
      description: 'Zero-based record offset',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_list_journals'],
      },
    },
    actionStatus: {
      type: 'number',
      description: 'Oracle action status; 0 means success',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_perform_journal_action', 'oracle_epm_fccs_update_journal_period'],
      },
    },
    actionDetail: {
      type: 'string',
      description: 'Oracle action detail',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_perform_journal_action', 'oracle_epm_fccs_update_journal_period'],
      },
    },
    scenario: {
      type: 'string',
      description: 'Requested scenario',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_update_journal_period'],
      },
    },
    year: {
      type: 'string',
      description: 'Requested year',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_update_journal_period'],
      },
    },
    period: {
      type: 'string',
      description: 'Requested period',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_update_journal_period'],
      },
    },
    action: {
      type: 'string',
      description: 'Requested action',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_update_journal_period'],
      },
    },
    submitted: {
      type: 'boolean',
      description: 'Oracle acknowledged submission; completion and job ID are not returned',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_export_consolidation_rulesets',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
    },
    message: {
      type: 'string',
      description: 'Documented submission acknowledgement',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_export_consolidation_rulesets',
          'oracle_epm_fccs_import_consolidation_rulesets',
        ],
      },
    },
    fileName: {
      type: 'string',
      description: 'Requested repository filename',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_fccs_upload_file',
          'oracle_epm_fccs_download_file',
          'oracle_epm_fccs_delete_file',
        ],
      },
    },
    file: {
      type: 'file',
      description: 'Bounded stored Sim UserFile (100 MiB maximum)',
      condition: {
        field: 'operation',
        value: ['oracle_epm_fccs_download_file'],
      },
    },
  },
}

export const OracleEpmFccsBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/performance-management/financial-consolidation-close/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Import and consolidate',
      prompt:
        'Build a workflow: On an approved input file, upload it, execute the saved application data import job with its file override, wait for success, then consolidate the selected Entity/Period/Scenario/Year and report the terminal job status.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Import and validate metadata',
      prompt:
        'Build a workflow: On an approved metadata ZIP, upload it, run the saved metadata import job, wait for completion, run Validate Metadata, and report warning/error counts and the validation filename.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Import rates and translate',
      prompt:
        'Build a workflow: On an approved exchange-rate CSV, upload it, run the saved exchange-rate import job and wait, then translate the chosen Entity/Period/Scenario/Year in a multi-currency application and report status.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Import and process journals',
      prompt:
        'Build a workflow: On an approved journal file, upload it, run the configured journal import and wait, list the resulting journal headers for the selected POV, then perform only the explicitly authorized journal action and report its status.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review and export journals',
      prompt:
        'Build a workflow: On a review request, page through journal headers for the selected POV/status, summarize them, run Export Journals with the requested filename, wait for completion, and download the external export if it fits 100 MiB.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Retrieve intercompany matching reports',
      prompt:
        'Build a workflow: On a close-review request, generate the saved intercompany matching report with the selected POV and filename, wait for completion, locate the external file in List Files, and download it when within 100 MiB.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor jobs and collect diagnostics',
      prompt:
        'Build a workflow: On a supplied execution job ID, wait for completion, read one page of details only for supported data/metadata import/export jobs, inspect child messages only for metadata jobs, and export the job console for additional diagnostics.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'import-and-consolidate-fccs',
      description: 'Import and consolidate.',
      content:
        '# Import and consolidate\n\n## Steps\n\nOn an approved input file, upload it, execute the saved application data import job with its file override, wait for success, then consolidate the selected Entity/Period/Scenario/Year and report the terminal job status.\n\n## Output\n\nReport documented counts, statuses and filenames. Submission is not completion. Do not infer missing tenant settings or line-item schemas.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_data.html',
    },
    {
      name: 'validate-fccs-metadata',
      description: 'Import and validate metadata.',
      content:
        '# Import and validate metadata\n\n## Steps\n\nOn an approved metadata ZIP, upload it, run the saved metadata import job, wait for completion, run Validate Metadata, and report warning/error counts and the validation filename.\n\n## Output\n\nReport documented counts, statuses and filenames. Submission is not completion. Do not infer missing tenant settings or line-item schemas.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_metadata.html',
    },
    {
      name: 'translate-fccs-balances',
      description: 'Import rates and translate.',
      content:
        '# Import rates and translate\n\n## Steps\n\nOn an approved exchange-rate CSV, upload it, run the saved exchange-rate import job and wait, then translate the chosen Entity/Period/Scenario/Year in a multi-currency application and report status.\n\n## Output\n\nReport documented counts, statuses and filenames. Submission is not completion. Do not infer missing tenant settings or line-item schemas.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/pbcs_import_exchange_rates.html',
    },
    {
      name: 'process-fccs-journals',
      description: 'Import and process journals.',
      content:
        '# Import and process journals\n\n## Steps\n\nOn an approved journal file, upload it, run the configured journal import and wait, list the resulting journal headers for the selected POV, then perform only the explicitly authorized journal action and report its status.\n\n## Output\n\nReport documented counts, statuses and filenames. Submission is not completion. Do not infer missing tenant settings or line-item schemas.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_import_consolidation_journals.html',
    },
    {
      name: 'review-fccs-journals',
      description: 'Review and export journals.',
      content:
        '# Review and export journals\n\n## Steps\n\nOn a review request, page through journal headers for the selected POV/status, summarize them, run Export Journals with the requested filename, wait for completion, and download the external export if it fits 100 MiB.\n\n## Output\n\nReport documented counts, statuses and filenames. Submission is not completion. Do not infer missing tenant settings or line-item schemas.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_export_consolidation_journals.html',
    },
    {
      name: 'retrieve-fccs-intercompany-reports',
      description: 'Retrieve intercompany matching reports.',
      content:
        '# Retrieve intercompany matching reports\n\n## Steps\n\nOn a close-review request, generate the saved intercompany matching report with the selected POV and filename, wait for completion, locate the external file in List Files, and download it when within 100 MiB.\n\n## Output\n\nReport documented counts, statuses and filenames. Submission is not completion. Do not infer missing tenant settings or line-item schemas.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_generate_ic_report.html',
    },
    {
      name: 'diagnose-fccs-jobs',
      description: 'Monitor jobs and collect diagnostics.',
      content:
        '# Monitor jobs and collect diagnostics\n\n## Steps\n\nOn a supplied execution job ID, wait for completion, read one page of details only for supported data/metadata import/export jobs, inspect child messages only for metadata jobs, and export the job console for additional diagnostics.\n\n## Output\n\nReport documented counts, statuses and filenames. Submission is not completion. Do not infer missing tenant settings or line-item schemas.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status_details.html',
    },
  ],
} as const satisfies BlockMeta
