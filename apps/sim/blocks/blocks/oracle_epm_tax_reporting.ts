import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { TaxReportingResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { parseTaxBooleanInput, parseTaxJsonInput } from '@/tools/oracle_epm_tax_reporting/utils'

const OPERATION_FIELDS: Record<string, readonly string[]> = {
  oracle_epm_tax_reporting_get_api_version: [],
  oracle_epm_tax_reporting_list_applications: [],
  oracle_epm_tax_reporting_list_job_definitions: ['application', 'jobType'],
  oracle_epm_tax_reporting_get_member: ['application', 'dimension', 'memberName'],
  oracle_epm_tax_reporting_add_member: ['application', 'dimension', 'memberName', 'parentName'],
  oracle_epm_tax_reporting_export_data_slice: ['application', 'planType', 'gridDefinition'],
  oracle_epm_tax_reporting_import_data_slice: [
    'application',
    'planType',
    'dataGrid',
    'aggregateEssbaseData',
    'dateFormat',
    'strictDateValidation',
  ],
  oracle_epm_tax_reporting_clear_data_slice: [
    'application',
    'planType',
    'gridDefinition',
    'clearEssbaseData',
    'clearPlanningData',
  ],
  oracle_epm_tax_reporting_copy_data: ['application', 'profileName', 'waitForCompletion'],
  oracle_epm_tax_reporting_clear_data: ['application', 'profileName', 'waitForCompletion'],
  oracle_epm_tax_reporting_run_rule: ['application', 'jobName', 'parameters', 'waitForCompletion'],
  oracle_epm_tax_reporting_run_ruleset: [
    'application',
    'jobName',
    'parameters',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_execute_job: [
    'application',
    'jobType',
    'jobName',
    'parameters',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_get_job_status: [
    'application',
    'jobId',
    'jobFamily',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_get_job_details: [
    'application',
    'jobId',
    'limit',
    'offset',
    'messageType',
  ],
  oracle_epm_tax_reporting_get_child_job_details: [
    'application',
    'jobId',
    'childJobId',
    'limit',
    'offset',
    'messageType',
  ],
  oracle_epm_tax_reporting_export_metadata: [
    'application',
    'jobName',
    'exportZipFileName',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_import_metadata: [
    'application',
    'jobName',
    'importZipFileName',
    'refreshCube',
    'errorFile',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_import_supplemental_collection_data: [
    'application',
    'fileName',
    'collection',
    'year',
    'period',
    'frequencyDimensions',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_deploy_form_templates: [
    'application',
    'collectionIntervalName',
    'templates',
    'frequencyDimensions',
    'resetWorkflows',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_import_supplemental_dimension_members: [
    'dimension',
    'fileName',
    'importMode',
    'delimiter',
    'dateFormat',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_generate_report: [
    'groupName',
    'reportName',
    'generatedReportFileName',
    'parameters',
    'format',
    'module',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_generate_user_details_report: [
    'fileName',
    'format',
    'waitForCompletion',
  ],
  oracle_epm_tax_reporting_get_report_status: [
    'jobId',
    'module',
    'reportStatusRoute',
    'waitForCompletion',
    'downloadReport',
  ],
  oracle_epm_tax_reporting_list_files: [],
  oracle_epm_tax_reporting_upload_file: ['file', 'fileName', 'directory'],
  oracle_epm_tax_reporting_download_file: ['fileName'],
}
const JSON_FIELDS = new Set([
  'parameters',
  'gridDefinition',
  'dataGrid',
  'frequencyDimensions',
  'templates',
])
const BOOLEAN_FIELDS = new Set([
  'aggregateEssbaseData',
  'strictDateValidation',
  'clearEssbaseData',
  'clearPlanningData',
  'waitForCompletion',
  'refreshCube',
  'resetWorkflows',
  'downloadReport',
])

export const OracleEpmTaxReportingBlock: BlockConfig<TaxReportingResponse> = {
  type: 'oracle_epm_tax_reporting',
  name: 'Oracle EPM Tax Reporting',
  description:
    'Run tax rules, manage metadata and supplemental data, inspect jobs, and generate reports',
  longDescription:
    'Connect a reusable Oracle EPM service-account credential using your HTTPS environment URL and Oracle username/password. Use an account permitted to authenticate with Basic authentication; MFA-only interactive login is not supported. Most administrative operations and discovery require Service Administrator; rule launch and supplemental features have their own role prerequisites. This integration provides 27 Tax Reporting operations for deployed rules, saved copy/clear profiles, metadata ZIP jobs, bounded core data slices, supplemental collections and templates, reports, and repository files. Scenarios, years, periods, entities, jurisdictions, countries, cubes, profile names, and runtime prompts are tenant-specific: use exact names or workflow references, not assumed defaults. Job definitions are distinct from submitted job IDs. Choose standalone-launchable deployed rules; many seeded Tax Automation rules are internal and cannot run independently. General bulk data movement belongs in Data Integration. Requests submit mutations once; optional waiting is bounded to 120 seconds, and local cancellation never cancels the Oracle job. Uploads are limited to 10 MiB and stored downloads to 100 MiB, subject to platform limits. Report generation uses its returned status-route family; Oracle documents the standalone /arm report-status endpoint separately, with inconsistent examples that require tenant verification. Documentation and tests use official API contracts; no live tenant validation is implied.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_tax_reporting',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle EPM Tax Reporting',
    sentences: {
      byOperation: {
        oracle_epm_tax_reporting_get_api_version: ['Get API version'],
        oracle_epm_tax_reporting_list_applications: ['List applications'],
        oracle_epm_tax_reporting_list_job_definitions: [
          {
            text: 'List job definitions in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'of type',
            field: 'jobType',
          },
        ],
        oracle_epm_tax_reporting_get_member: [
          {
            text: 'Look up',
            field: 'memberName',
            core: true,
          },
          {
            text: 'in dimension',
            field: 'dimension',
          },
          {
            text: 'of',
            field: ['applicationSelector', 'applicationManual'],
          },
        ],
        oracle_epm_tax_reporting_add_member: [
          {
            text: 'Add',
            field: 'memberName',
            core: true,
          },
          {
            text: 'under',
            field: 'parentName',
            core: true,
          },
          {
            text: 'in dimension',
            field: 'dimension',
          },
        ],
        oracle_epm_tax_reporting_export_data_slice: [
          {
            text: 'Export data from',
            field: 'planType',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
          {
            text: 'using',
            field: 'gridDefinition',
          },
        ],
        oracle_epm_tax_reporting_import_data_slice: [
          {
            text: 'Import data into',
            field: 'planType',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
          {
            text: 'from',
            field: 'dataGrid',
          },
        ],
        oracle_epm_tax_reporting_clear_data_slice: [
          {
            text: 'Clear data from',
            field: 'planType',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
          {
            text: 'using',
            field: 'gridDefinition',
          },
        ],
        oracle_epm_tax_reporting_copy_data: [
          {
            text: 'Copy data using',
            field: 'profileName',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
        ],
        oracle_epm_tax_reporting_clear_data: [
          {
            text: 'Clear data using',
            field: 'profileName',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
        ],
        oracle_epm_tax_reporting_run_rule: [
          {
            text: 'Run rule',
            field: ['jobNameSelector', 'jobNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
          {
            text: 'with',
            field: 'parameters',
          },
        ],
        oracle_epm_tax_reporting_run_ruleset: [
          {
            text: 'Run ruleset',
            field: ['jobNameSelector', 'jobNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
          {
            text: 'with',
            field: 'parameters',
          },
        ],
        oracle_epm_tax_reporting_execute_job: [
          {
            text: 'Execute',
            field: ['jobNameSelector', 'jobNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
          {
            text: 'as',
            field: 'jobType',
          },
        ],
        oracle_epm_tax_reporting_get_job_status: [
          {
            text: 'Check job',
            field: 'jobId',
            core: true,
          },
          {
            text: 'in family',
            field: 'jobFamily',
          },
        ],
        oracle_epm_tax_reporting_get_job_details: [
          {
            text: 'Get details for job',
            field: 'jobId',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
        ],
        oracle_epm_tax_reporting_get_child_job_details: [
          {
            text: 'Get details for child job',
            field: 'childJobId',
            core: true,
          },
          {
            text: 'of job',
            field: 'jobId',
          },
        ],
        oracle_epm_tax_reporting_export_metadata: [
          {
            text: 'Export metadata using',
            field: ['jobNameSelector', 'jobNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
        ],
        oracle_epm_tax_reporting_import_metadata: [
          {
            text: 'Import metadata using',
            field: ['jobNameSelector', 'jobNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
          },
        ],
        oracle_epm_tax_reporting_import_supplemental_collection_data: [
          {
            text: 'Import',
            field: 'fileName',
            core: true,
          },
          {
            text: 'into',
            field: 'collection',
            core: true,
          },
          {
            text: 'for',
            field: 'period',
          },
        ],
        oracle_epm_tax_reporting_deploy_form_templates: [
          {
            text: 'Deploy',
            field: 'templates',
            core: true,
          },
          {
            text: 'for interval',
            field: 'collectionIntervalName',
            core: true,
          },
        ],
        oracle_epm_tax_reporting_import_supplemental_dimension_members: [
          {
            text: 'Import members from',
            field: 'fileName',
            core: true,
          },
          {
            text: 'into',
            field: 'dimension',
            core: true,
          },
          {
            text: 'using',
            field: 'importMode',
          },
        ],
        oracle_epm_tax_reporting_generate_report: [
          {
            text: 'Generate',
            field: 'reportName',
            core: true,
          },
          {
            text: 'from group',
            field: 'groupName',
          },
          {
            text: 'as',
            field: 'format',
          },
        ],
        oracle_epm_tax_reporting_generate_user_details_report: [
          {
            text: 'Export user details to',
            field: 'fileName',
            core: true,
          },
          {
            text: 'as',
            field: 'format',
          },
        ],
        oracle_epm_tax_reporting_get_report_status: [
          {
            text: 'Check report job',
            field: 'jobId',
            core: true,
          },
          {
            text: 'using',
            field: 'reportStatusRoute',
          },
        ],
        oracle_epm_tax_reporting_list_files: ['List repository files'],
        oracle_epm_tax_reporting_upload_file: [
          {
            text: 'Upload',
            field: ['fileUpload', 'fileReference'],
            core: true,
          },
          {
            text: 'as',
            field: 'fileName',
            core: true,
          },
          {
            text: 'to',
            field: 'directory',
          },
        ],
        oracle_epm_tax_reporting_download_file: [
          {
            text: 'Download',
            field: 'fileName',
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
      serviceId: 'oracle_epm_tax_reporting',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      placeholder: 'Select Oracle EPM service account',
    },
    {
      id: 'manualCredential',
      title: 'Oracle EPM Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { id: 'oracle_epm_tax_reporting_get_api_version', label: 'Get API Version' },
        { id: 'oracle_epm_tax_reporting_list_applications', label: 'List Applications' },
        { id: 'oracle_epm_tax_reporting_list_job_definitions', label: 'List Job Definitions' },
        { id: 'oracle_epm_tax_reporting_get_member', label: 'Get Member' },
        { id: 'oracle_epm_tax_reporting_add_member', label: 'Add Member' },
        { id: 'oracle_epm_tax_reporting_export_data_slice', label: 'Export Data Slice' },
        { id: 'oracle_epm_tax_reporting_import_data_slice', label: 'Import Data Slice' },
        { id: 'oracle_epm_tax_reporting_clear_data_slice', label: 'Clear Data Slice' },
        { id: 'oracle_epm_tax_reporting_copy_data', label: 'Copy Data' },
        { id: 'oracle_epm_tax_reporting_clear_data', label: 'Clear Data' },
        { id: 'oracle_epm_tax_reporting_run_rule', label: 'Run Rule' },
        { id: 'oracle_epm_tax_reporting_run_ruleset', label: 'Run Ruleset' },
        { id: 'oracle_epm_tax_reporting_execute_job', label: 'Execute Job' },
        { id: 'oracle_epm_tax_reporting_get_job_status', label: 'Get Job Status' },
        { id: 'oracle_epm_tax_reporting_get_job_details', label: 'Get Job Details' },
        { id: 'oracle_epm_tax_reporting_get_child_job_details', label: 'Get Child Job Details' },
        { id: 'oracle_epm_tax_reporting_export_metadata', label: 'Export Metadata' },
        { id: 'oracle_epm_tax_reporting_import_metadata', label: 'Import Metadata' },
        {
          id: 'oracle_epm_tax_reporting_import_supplemental_collection_data',
          label: 'Import Supplemental Collection Data',
        },
        { id: 'oracle_epm_tax_reporting_deploy_form_templates', label: 'Deploy Form Templates' },
        {
          id: 'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          label: 'Import Supplemental Dimension Members',
        },
        { id: 'oracle_epm_tax_reporting_generate_report', label: 'Generate Report' },
        {
          id: 'oracle_epm_tax_reporting_generate_user_details_report',
          label: 'Generate User Details Report',
        },
        { id: 'oracle_epm_tax_reporting_get_report_status', label: 'Get Report Status' },
        { id: 'oracle_epm_tax_reporting_list_files', label: 'List Files' },
        { id: 'oracle_epm_tax_reporting_upload_file', label: 'Upload File' },
        { id: 'oracle_epm_tax_reporting_download_file', label: 'Download File' },
      ],
      value: () => 'oracle_epm_tax_reporting_list_applications',
      required: true,
    },
    {
      id: 'applicationSelector',
      title: 'Application',
      type: 'project-selector',
      serviceId: 'oracle_epm_tax_reporting',
      selectorKey: 'oracle_epm_tax_reporting.applications',
      canonicalParamId: 'application',
      mode: 'basic',
      dependsOn: ['oauthCredential'],
      placeholder: 'Select application',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_list_job_definitions',
          'oracle_epm_tax_reporting_get_member',
          'oracle_epm_tax_reporting_add_member',
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
        ],
      },
      required: (values) => ({
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_list_job_definitions',
          'oracle_epm_tax_reporting_get_member',
          'oracle_epm_tax_reporting_add_member',
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          ...(values?.jobFamily !== 'supplemental_dimension'
            ? ['oracle_epm_tax_reporting_get_job_status']
            : []),
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
        ],
      }),
    },
    {
      id: 'applicationManual',
      title: 'Application',
      type: 'short-input',
      canonicalParamId: 'application',
      mode: 'advanced',
      placeholder: 'Exact name or reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_list_job_definitions',
          'oracle_epm_tax_reporting_get_member',
          'oracle_epm_tax_reporting_add_member',
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
        ],
      },
      required: (values) => ({
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_list_job_definitions',
          'oracle_epm_tax_reporting_get_member',
          'oracle_epm_tax_reporting_add_member',
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          ...(values?.jobFamily !== 'supplemental_dimension'
            ? ['oracle_epm_tax_reporting_get_job_status']
            : []),
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
        ],
      }),
    },
    {
      id: 'jobNameSelector',
      title: 'Job Name',
      type: 'project-selector',
      serviceId: 'oracle_epm_tax_reporting',
      selectorKey: 'oracle_epm_tax_reporting.jobDefinitions',
      canonicalParamId: 'jobName',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'application', 'jobType', 'operation'],
      placeholder: 'Select job name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
        ],
      },
    },
    {
      id: 'jobNameManual',
      title: 'Job Name',
      type: 'short-input',
      canonicalParamId: 'jobName',
      mode: 'advanced',
      placeholder: 'Exact name or reference',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
        ],
      },
    },
    {
      id: 'jobType',
      title: 'Job Type',
      type: 'dropdown',
      placeholder: 'Supported saved job type: RULES, RULESET, EXPORT_METADATA, or IMPORT_METADATA.',
      options: [
        { id: 'RULES', label: 'RULES' },
        { id: 'RULESET', label: 'RULESET' },
        { id: 'EXPORT_METADATA', label: 'EXPORT_METADATA' },
        { id: 'IMPORT_METADATA', label: 'IMPORT_METADATA' },
      ],
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_list_job_definitions',
          'oracle_epm_tax_reporting_execute_job',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_execute_job'] },
    },
    {
      id: 'parameters',
      title: 'Parameters',
      type: 'long-input',
      placeholder:
        'JSON object of documented job parameters or tenant-defined runtime prompts. Rule prompt values must be strings; preserve exact prompt names.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_generate_report',
        ],
      },
      required: false,
      rows: 5,
      wandConfig: {
        enabled: true,
        prompt:
          'Return only a JSON object using documented parameters for the selected operation or exact tenant-provided runtime prompt names. Rule and ruleset values must be strings; do not invent prompts. For execute_job metadata jobs, use only exportZipFileName or importZipFileName, refreshCube, errorFile as appropriate.',
        placeholder: 'Describe the exact tenant inputs and intended scope',
      },
    },
    {
      id: 'dimension',
      title: 'Dimension',
      type: 'short-input',
      placeholder:
        'Exact dimension name, such as Entity or Jurisdiction, as configured in this tenant.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_member',
          'oracle_epm_tax_reporting_add_member',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_member',
          'oracle_epm_tax_reporting_add_member',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
        ],
      },
    },
    {
      id: 'memberName',
      title: 'Member Name',
      type: 'short-input',
      placeholder: 'Exact dimension member name.',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    {
      id: 'parentName',
      title: 'Parent Name',
      type: 'short-input',
      placeholder: 'Parent member enabled for dynamic children, after a cube refresh.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_add_member'] },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_add_member'] },
    },
    {
      id: 'planType',
      title: 'Plan Type',
      type: 'short-input',
      placeholder: 'Exact Tax Reporting cube/plan type name configured in the application.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
        ],
      },
    },
    {
      id: 'gridDefinition',
      title: 'Grid Definition',
      type: 'long-input',
      placeholder:
        'JSON region with pov: {dimensions?: string[], members: string[][]}, columns and rows arrays of the same axis shape. Use exact tenant dimension/member names or documented member-selection expressions. Optional suppressMissingBlocks, suppressMissingRows, suppressMissingColumns booleans.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_export_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
        ],
      },
      rows: 5,
      wandConfig: {
        enabled: true,
        prompt:
          'Return only a JSON grid definition with pov {dimensions, members}, columns and rows arrays of {dimensions, members}. Members is an array of string arrays corresponding to dimensions. Use only exact tenant-provided cube, scenario, year, period, entity and jurisdiction member names. Do not invent members or broaden the requested clear/export region.',
        placeholder: 'Describe the exact tenant inputs and intended scope',
      },
    },
    {
      id: 'dataGrid',
      title: 'Data Grid',
      type: 'long-input',
      placeholder:
        'JSON grid with pov: string[], columns: string[][], rows: [{headers: string[], data: (string | number)[]}]. Values overwrite existing cells by default; #missing clears a cell. Cell notes and supporting details are not handled by this tool.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_import_data_slice'] },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_import_data_slice'] },
      rows: 5,
      wandConfig: {
        enabled: true,
        prompt:
          'Return only core import JSON {pov: string[], columns: string[][], rows: [{headers: string[], data: (string|number)[]}]}. Use exact tenant-provided dimension order and members. Do not include notes or supporting detail, infer tax amounts, or expand the requested region.',
        placeholder: 'Describe the exact tenant inputs and intended scope',
      },
    },
    {
      id: 'aggregateEssbaseData',
      title: 'Aggregate Essbase Data',
      type: 'switch',
      placeholder:
        'Add numeric values to existing values when true; overwrite when false. Do not retry an uncertain additive import.',
      defaultValue: false,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_import_data_slice'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'dateFormat',
      title: 'Date Format',
      type: 'short-input',
      placeholder:
        'Data slices: MM-DD-YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, or YYYY/MM/DD. Supplemental member import: the tenant CSV date format (Oracle default MM-dd-yyyy).',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'strictDateValidation',
      title: 'Strict Date Validation',
      type: 'switch',
      placeholder: 'Reject dates that do not match dateFormat (Oracle default true).',
      defaultValue: true,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_import_data_slice'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'clearEssbaseData',
      title: 'Clear Essbase Data',
      type: 'switch',
      placeholder: 'Clear numeric cube data (default true). This is destructive.',
      defaultValue: true,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_clear_data_slice'] },
      required: false,
    },
    {
      id: 'clearPlanningData',
      title: 'Clear Planning Data',
      type: 'switch',
      placeholder:
        'Delete cell notes, attachments, and supporting details (default false). This is destructive.',
      defaultValue: false,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_clear_data_slice'] },
      required: false,
    },
    {
      id: 'profileName',
      title: 'Profile Name',
      type: 'short-input',
      placeholder:
        'Name of an existing Tax Reporting copy or clear data profile; its saved configuration determines the affected POV.',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_copy_data', 'oracle_epm_tax_reporting_clear_data'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_copy_data', 'oracle_epm_tax_reporting_clear_data'],
      },
    },
    {
      id: 'waitForCompletion',
      title: 'Wait For Completion',
      type: 'switch',
      placeholder:
        'Wait at most 120 seconds, subject to the execution deadline. Default false. Timeout or local cancellation does not cancel the Oracle job; check its status before resubmitting.',
      defaultValue: false,
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_get_report_status',
        ],
      },
      required: false,
    },
    {
      id: 'jobId',
      title: 'Job Id',
      type: 'short-input',
      placeholder: 'Submitted Oracle job instance ID, not a job definition name.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_get_report_status',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_get_report_status',
        ],
      },
    },
    {
      id: 'jobFamily',
      title: 'Job Family',
      type: 'dropdown',
      value: () => 'planning',
      placeholder:
        'planning (default), supplemental_collection (fcmjobs), or supplemental_dimension (sdm/jobs). Use the family that submitted the job.',
      options: [
        { id: 'planning', label: 'planning' },
        { id: 'supplemental_collection', label: 'supplemental_collection' },
        { id: 'supplemental_dimension', label: 'supplemental_dimension' },
      ],
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_get_job_status'] },
      required: false,
    },
    {
      id: 'childJobId',
      title: 'Child Job Id',
      type: 'short-input',
      placeholder: 'Child job ID from the parent job details child-job-details link.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_get_child_job_details'] },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_get_child_job_details'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Page size, 1-100 (default 25). One page is returned.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Zero-based offset, 0-100000 (default 0). No automatic fetch-all.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'messageType',
      title: 'Message Type',
      type: 'dropdown',
      placeholder: 'Filter detailed messages by INFO, ERROR, or WARNING.',
      options: [
        { id: 'INFO', label: 'INFO' },
        { id: 'ERROR', label: 'ERROR' },
        { id: 'WARNING', label: 'WARNING' },
      ],
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'exportZipFileName',
      title: 'Export Zip File Name',
      type: 'short-input',
      placeholder: 'Optional ZIP output filename for the saved metadata export job.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_export_metadata'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'importZipFileName',
      title: 'Import Zip File Name',
      type: 'short-input',
      placeholder:
        'Optional ZIP filename already uploaded to the Oracle repository for the saved metadata import job.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_import_metadata'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'refreshCube',
      title: 'Refresh Cube',
      type: 'dropdown',
      placeholder: 'Refresh the cube after importing metadata when true.',
      value: () => '',
      options: [
        { id: '', label: 'Use saved job default' },
        { id: 'false', label: 'false' },
        { id: 'true', label: 'true' },
      ],
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_import_metadata'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'errorFile',
      title: 'Error File',
      type: 'short-input',
      placeholder:
        'ZIP filename for metadata import errors; an existing file of the same name is overwritten.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_import_metadata'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder:
        'Exact Oracle repository filename/path. Supply raw names, not pre-encoded URL text. Upload fails if a file already exists.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_upload_file',
          'oracle_epm_tax_reporting_download_file',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_upload_file',
          'oracle_epm_tax_reporting_download_file',
        ],
      },
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      placeholder: 'Exact Supplemental Data collection name. Supplemental Data must be enabled.',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_collection_data'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_collection_data'],
      },
    },
    {
      id: 'year',
      title: 'Year',
      type: 'short-input',
      placeholder: 'Collection year member, for example FY26; tenant-specific.',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_collection_data'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_collection_data'],
      },
    },
    {
      id: 'period',
      title: 'Period',
      type: 'short-input',
      placeholder: 'Collection period member, for example Jan; tenant-specific.',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_collection_data'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_collection_data'],
      },
    },
    {
      id: 'frequencyDimensions',
      title: 'Frequency Dimensions',
      type: 'long-input',
      placeholder:
        'JSON object of additional collection-interval frequency dimension names and member strings. Preserve case. For template deployment supply all configured dimensions (up to four), including Year/Period when applicable.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
        ],
      },
      required: false,
      rows: 5,
      wandConfig: {
        enabled: true,
        prompt:
          'Return only a JSON object mapping exact tenant-provided collection interval frequency dimension names to member strings. Preserve case; do not invent dimensions. Collection import has dedicated year and period fields; template deployment may include Year and Period here.',
        placeholder: 'Describe the exact tenant inputs and intended scope',
      },
    },
    {
      id: 'collectionIntervalName',
      title: 'Collection Interval Name',
      type: 'short-input',
      placeholder: 'Existing Supplemental Data collection interval name.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_deploy_form_templates'] },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_deploy_form_templates'] },
    },
    {
      id: 'templates',
      title: 'Templates',
      type: 'long-input',
      placeholder:
        'Template name array. An explicit empty array deploys ALL templates for the interval; use named templates to limit scope.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_deploy_form_templates'] },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_deploy_form_templates'] },
      rows: 5,
      wandConfig: {
        enabled: true,
        prompt:
          'Return only an array of exact tenant-provided Supplemental Data template names. An empty array deploys ALL templates; never use it unless the user explicitly requests all templates.',
        placeholder: 'Describe the exact tenant inputs and intended scope',
      },
    },
    {
      id: 'resetWorkflows',
      title: 'Reset Workflows',
      type: 'switch',
      placeholder: 'Reset existing form workflows during deployment (default false).',
      defaultValue: false,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_deploy_form_templates'] },
      required: false,
    },
    {
      id: 'importMode',
      title: 'Import Mode',
      type: 'dropdown',
      value: () => 'Replace',
      placeholder:
        'Replace (default) or Update supplemental dimension members. Replace can remove existing members.',
      options: [
        { id: 'Replace', label: 'Replace' },
        { id: 'Update', label: 'Update' },
      ],
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_dimension_members'],
      },
      required: false,
    },
    {
      id: 'delimiter',
      title: 'Delimiter',
      type: 'short-input',
      placeholder: 'Single-character supplemental CSV delimiter (Oracle default comma).',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_supplemental_dimension_members'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Configured report group, such as Task Manager.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_generate_report'] },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_generate_report'] },
    },
    {
      id: 'reportName',
      title: 'Report Name',
      type: 'short-input',
      placeholder: 'Exact existing report name. Provide all parameters required by that report.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_generate_report'] },
      required: { field: 'operation', value: ['oracle_epm_tax_reporting_generate_report'] },
    },
    {
      id: 'generatedReportFileName',
      title: 'Generated Report File Name',
      type: 'short-input',
      placeholder:
        'Output filename with matching extension. Existing files with this name are overwritten. Defaults to the report name in Oracle.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_generate_report'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      value: () => '',
      options: (values) => [
        { id: '', label: 'Oracle default (PDF report / CSV user details)' },
        ...(values?.operation === 'oracle_epm_tax_reporting_generate_user_details_report'
          ? ['CSV', 'XLS']
          : ['HTML', 'PDF', 'XLSX', 'CSV']
        ).map((id) => ({ id, label: id })),
      ],
      placeholder: 'Report format.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
        ],
      },
      required: false,
    },
    {
      id: 'module',
      title: 'Module',
      type: 'dropdown',
      options: (values) =>
        (values?.operation === 'oracle_epm_tax_reporting_generate_report'
          ? ['FCM', 'SDM']
          : ['FCCS', 'SDM']
        ).map((id) => ({ id, label: id })),
      placeholder:
        'Report generation: FCM (Task Manager) or SDM. Report status: FCCS (Task Manager) or SDM.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_get_report_status',
        ],
      },
      required: (values) => ({
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_generate_report',
          ...(values?.reportStatusRoute !== 'user_details'
            ? ['oracle_epm_tax_reporting_get_report_status']
            : []),
        ],
      }),
    },
    {
      id: 'reportStatusRoute',
      title: 'Report Status Route',
      type: 'dropdown',
      value: () => 'standalone',
      placeholder:
        'standalone (default): documented /arm job endpoint; generated_report: route used by Generate Report Job Status links; user_details: route used by User Details Job Status links. They are not interchangeable.',
      options: [
        { id: 'standalone', label: 'standalone' },
        { id: 'generated_report', label: 'generated_report' },
        { id: 'user_details', label: 'user_details' },
      ],
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_get_report_status'] },
      required: false,
    },
    {
      id: 'downloadReport',
      title: 'Download Report',
      type: 'switch',
      placeholder:
        'Store the completed report as a Sim file using its validated report-content link (default false). Requires a workflow execution context.',
      defaultValue: false,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_get_report_status'] },
      required: false,
    },
    {
      id: 'directory',
      title: 'Directory',
      type: 'short-input',
      placeholder:
        'Optional Oracle inbox or outbox directory, including a subdirectory. Other EPM product directories are not supported.',
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_upload_file'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'fileUpload',
      title: 'Source File',
      type: 'file-upload',
      canonicalParamId: 'file',
      mode: 'basic',
      multiple: false,
      maxSize: 10,
      canvasNoun: 'a file',
      required: true,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_upload_file'] },
    },
    {
      id: 'fileReference',
      title: 'Source File',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      placeholder: 'Reference a Sim file',
      canvasNoun: 'a file',
      required: true,
      condition: { field: 'operation', value: ['oracle_epm_tax_reporting_upload_file'] },
    },
  ],
  tools: {
    access: [
      'oracle_epm_tax_reporting_get_api_version',
      'oracle_epm_tax_reporting_list_applications',
      'oracle_epm_tax_reporting_list_job_definitions',
      'oracle_epm_tax_reporting_get_member',
      'oracle_epm_tax_reporting_add_member',
      'oracle_epm_tax_reporting_export_data_slice',
      'oracle_epm_tax_reporting_import_data_slice',
      'oracle_epm_tax_reporting_clear_data_slice',
      'oracle_epm_tax_reporting_copy_data',
      'oracle_epm_tax_reporting_clear_data',
      'oracle_epm_tax_reporting_run_rule',
      'oracle_epm_tax_reporting_run_ruleset',
      'oracle_epm_tax_reporting_execute_job',
      'oracle_epm_tax_reporting_get_job_status',
      'oracle_epm_tax_reporting_get_job_details',
      'oracle_epm_tax_reporting_get_child_job_details',
      'oracle_epm_tax_reporting_export_metadata',
      'oracle_epm_tax_reporting_import_metadata',
      'oracle_epm_tax_reporting_import_supplemental_collection_data',
      'oracle_epm_tax_reporting_deploy_form_templates',
      'oracle_epm_tax_reporting_import_supplemental_dimension_members',
      'oracle_epm_tax_reporting_generate_report',
      'oracle_epm_tax_reporting_generate_user_details_report',
      'oracle_epm_tax_reporting_get_report_status',
      'oracle_epm_tax_reporting_list_files',
      'oracle_epm_tax_reporting_upload_file',
      'oracle_epm_tax_reporting_download_file',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const fields = OPERATION_FIELDS[params.operation]
        if (!fields) return {}
        const result: Record<string, unknown> = { oauthCredential: params.oauthCredential }
        for (const key of fields) {
          const value = params[key]
          if (value === undefined || value === null || value === '') continue
          if (JSON_FIELDS.has(key)) result[key] = parseTaxJsonInput(value, key)
          else if (BOOLEAN_FIELDS.has(key)) result[key] = parseTaxBooleanInput(value)
          else if (key === 'file') result[key] = normalizeFileInput(value, { single: true })
          else if (key === 'limit' || key === 'offset')
            result[key] = parseOptionalNumberInput(value, key, {
              integer: true,
              min: key === 'limit' ? 1 : 0,
              max: key === 'limit' ? 100 : 100000,
            })
          else result[key] = value
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Selected Tax Reporting operation' },
    oauthCredential: {
      type: 'string',
      description: 'Reusable Oracle EPM service-account credential',
    },
    ...{
      application: {
        type: 'string',
        description:
          'Exact Tax Reporting application name; use application discovery or a tenant-specific reference.',
      },
      jobType: {
        type: 'string',
        description:
          'Supported saved job type: RULES, RULESET, EXPORT_METADATA, or IMPORT_METADATA.',
      },
      parameters: {
        type: 'json',
        description:
          'JSON object of documented job parameters or tenant-defined runtime prompts. Rule prompt values must be strings; preserve exact prompt names.',
      },
      dimension: {
        type: 'string',
        description:
          'Exact dimension name, such as Entity or Jurisdiction, as configured in this tenant.',
      },
      memberName: {
        type: 'string',
        description: 'Exact dimension member name.',
      },
      parentName: {
        type: 'string',
        description: 'Parent member enabled for dynamic children, after a cube refresh.',
      },
      planType: {
        type: 'string',
        description: 'Exact Tax Reporting cube/plan type name configured in the application.',
      },
      gridDefinition: {
        type: 'json',
        description:
          'JSON region with pov: {dimensions?: string[], members: string[][]}, columns and rows arrays of the same axis shape. Use exact tenant dimension/member names or documented member-selection expressions. Optional suppressMissingBlocks, suppressMissingRows, suppressMissingColumns booleans.',
      },
      dataGrid: {
        type: 'json',
        description:
          'JSON grid with pov: string[], columns: string[][], rows: [{headers: string[], data: (string | number)[]}]. Values overwrite existing cells by default; #missing clears a cell. Cell notes and supporting details are not handled by this tool.',
      },
      aggregateEssbaseData: {
        type: 'boolean',
        description:
          'Add numeric values to existing values when true; overwrite when false. Do not retry an uncertain additive import.',
      },
      dateFormat: {
        type: 'string',
        description:
          'Data slices: MM-DD-YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, or YYYY/MM/DD. Supplemental member import: the tenant CSV date format (Oracle default MM-dd-yyyy).',
      },
      strictDateValidation: {
        type: 'boolean',
        description: 'Reject dates that do not match dateFormat (Oracle default true).',
      },
      clearEssbaseData: {
        type: 'boolean',
        description: 'Clear numeric cube data (default true). This is destructive.',
      },
      clearPlanningData: {
        type: 'boolean',
        description:
          'Delete cell notes, attachments, and supporting details (default false). This is destructive.',
      },
      profileName: {
        type: 'string',
        description:
          'Name of an existing Tax Reporting copy or clear data profile; its saved configuration determines the affected POV.',
      },
      waitForCompletion: {
        type: 'boolean',
        description:
          'Wait at most 120 seconds, subject to the execution deadline. Default false. Timeout or local cancellation does not cancel the Oracle job; check its status before resubmitting.',
      },
      jobId: {
        type: 'string',
        description: 'Submitted Oracle job instance ID, not a job definition name.',
      },
      jobFamily: {
        type: 'string',
        description:
          'planning (default), supplemental_collection (fcmjobs), or supplemental_dimension (sdm/jobs). Use the family that submitted the job.',
      },
      childJobId: {
        type: 'string',
        description: 'Child job ID from the parent job details child-job-details link.',
      },
      limit: {
        type: 'number',
        description: 'Page size, 1-100 (default 25). One page is returned.',
      },
      offset: {
        type: 'number',
        description: 'Zero-based offset, 0-100000 (default 0). No automatic fetch-all.',
      },
      messageType: {
        type: 'string',
        description: 'Filter detailed messages by INFO, ERROR, or WARNING.',
      },
      exportZipFileName: {
        type: 'string',
        description: 'Optional ZIP output filename for the saved metadata export job.',
      },
      importZipFileName: {
        type: 'string',
        description:
          'Optional ZIP filename already uploaded to the Oracle repository for the saved metadata import job.',
      },
      refreshCube: {
        type: 'boolean',
        description: 'Refresh the cube after importing metadata when true.',
      },
      errorFile: {
        type: 'string',
        description:
          'ZIP filename for metadata import errors; an existing file of the same name is overwritten.',
      },
      fileName: {
        type: 'string',
        description:
          'Exact Oracle repository filename/path. Supply raw names, not pre-encoded URL text. Upload fails if a file already exists.',
      },
      collection: {
        type: 'string',
        description: 'Exact Supplemental Data collection name. Supplemental Data must be enabled.',
      },
      year: {
        type: 'string',
        description: 'Collection year member, for example FY26; tenant-specific.',
      },
      period: {
        type: 'string',
        description: 'Collection period member, for example Jan; tenant-specific.',
      },
      frequencyDimensions: {
        type: 'json',
        description:
          'JSON object of additional collection-interval frequency dimension names and member strings. Preserve case. For template deployment supply all configured dimensions (up to four), including Year/Period when applicable.',
      },
      collectionIntervalName: {
        type: 'string',
        description: 'Existing Supplemental Data collection interval name.',
      },
      templates: {
        type: 'array',
        description:
          'Template name array. An explicit empty array deploys ALL templates for the interval; use named templates to limit scope.',
      },
      resetWorkflows: {
        type: 'boolean',
        description: 'Reset existing form workflows during deployment (default false).',
      },
      importMode: {
        type: 'string',
        description:
          'Replace (default) or Update supplemental dimension members. Replace can remove existing members.',
      },
      delimiter: {
        type: 'string',
        description: 'Single-character supplemental CSV delimiter (Oracle default comma).',
      },
      groupName: {
        type: 'string',
        description: 'Configured report group, such as Task Manager.',
      },
      reportName: {
        type: 'string',
        description: 'Exact existing report name. Provide all parameters required by that report.',
      },
      generatedReportFileName: {
        type: 'string',
        description:
          'Output filename with matching extension. Existing files with this name are overwritten. Defaults to the report name in Oracle.',
      },
      format: {
        type: 'string',
        description: 'Report format.',
      },
      module: {
        type: 'string',
        description:
          'Report generation: FCM (Task Manager) or SDM. Report status: FCCS (Task Manager) or SDM.',
      },
      reportStatusRoute: {
        type: 'string',
        description:
          'standalone (default): documented /arm job endpoint; generated_report: route used by Generate Report Job Status links; user_details: route used by User Details Job Status links. They are not interchangeable.',
      },
      downloadReport: {
        type: 'boolean',
        description:
          'Store the completed report as a Sim file using its validated report-content link (default false). Requires a workflow execution context.',
      },
      file: {
        type: 'file',
        description:
          'One authorized Sim UserFile to upload, up to 10 MiB. URLs alone are not accepted.',
      },
      directory: {
        type: 'string',
        description:
          'Optional Oracle inbox or outbox directory, including a subdirectory. Other EPM product directories are not supported.',
      },
      jobName: {
        type: 'string',
        description:
          'Exact deployed rule, ruleset, or saved job definition name. Names are case-sensitive.',
      },
    },
  },
  outputs: {
    version: {
      type: 'string',
      description: 'API version',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_api_version'],
      },
    },
    lifecycle: {
      type: 'string',
      description: 'API lifecycle',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_api_version'],
      },
    },
    isLatest: {
      type: 'boolean',
      description: 'Whether this is the latest API version',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_api_version'],
      },
    },
    items: {
      type: 'array',
      description: 'Accessible applications (bounded to 1,000)',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_list_applications',
          'oracle_epm_tax_reporting_list_job_definitions',
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_list_files',
        ],
      },
    },
    name: {
      type: 'string',
      description: 'Member name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    parentName: {
      type: 'string',
      description: 'Parent member',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    description: {
      type: 'string',
      description: 'Member description',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    dataType: {
      type: 'string',
      description: 'Member data type',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    objectType: {
      type: 'number',
      description: 'Oracle object type',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    dataStorage: {
      type: 'string',
      description: 'Storage attribute',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    dimName: {
      type: 'string',
      description: 'Dimension name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    twoPass: {
      type: 'boolean',
      description: 'Two-pass calculation attribute',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_get_member', 'oracle_epm_tax_reporting_add_member'],
      },
    },
    pov: {
      type: 'array',
      description: 'Point-of-view member names',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_export_data_slice'],
      },
    },
    columns: {
      type: 'array',
      description: 'Arrays of column member names',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_export_data_slice'],
      },
    },
    rows: {
      type: 'array',
      description: 'Core data rows (up to 1,000)',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_export_data_slice'],
      },
    },
    numAcceptedCells: {
      type: 'number',
      description: 'Cells accepted for save',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_data_slice'],
      },
    },
    numUpdateCells: {
      type: 'number',
      description: 'Cells actually updated',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_data_slice'],
      },
    },
    numRejectedCells: {
      type: 'number',
      description: 'Rejected cells',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
        ],
      },
    },
    rejectedCells: {
      type: 'array',
      description: 'First 100 rejected cell intersections',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_import_data_slice',
          'oracle_epm_tax_reporting_clear_data_slice',
        ],
      },
    },
    rejectedCellsWithDetails: {
      type: 'array',
      description: 'First 100 rejection diagnostics',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_import_data_slice'],
      },
    },
    numClearedCells: {
      type: 'number',
      description: 'Cleared cells',
      condition: {
        field: 'operation',
        value: ['oracle_epm_tax_reporting_clear_data_slice'],
      },
    },
    status: {
      type: 'number',
      description:
        'Oracle status: -1 pending, 0 success; other statuses depend on job family. 2 means cancellation pending for planning jobs.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_get_report_status',
          'oracle_epm_tax_reporting_list_files',
          'oracle_epm_tax_reporting_upload_file',
        ],
      },
    },
    jobId: {
      type: 'string',
      description: 'Submitted job ID, normalized from documented jobId/jobID when returned.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_get_report_status',
        ],
      },
    },
    jobName: {
      type: 'string',
      description: 'Oracle job name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
        ],
      },
    },
    details: {
      type: 'string',
      description: 'Oracle job details',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_get_report_status',
          'oracle_epm_tax_reporting_list_files',
          'oracle_epm_tax_reporting_upload_file',
        ],
      },
    },
    descriptiveStatus: {
      type: 'string',
      description: 'Oracle status description',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
        ],
      },
    },
    links: {
      type: 'array',
      description:
        'Documented Oracle links; returned links must be validated before authenticated use.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_get_job_details',
          'oracle_epm_tax_reporting_get_child_job_details',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_get_report_status',
          'oracle_epm_tax_reporting_upload_file',
        ],
      },
    },
    detailedStatus: {
      type: 'number',
      description: 'Oracle granular job status code, when returned.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
        ],
      },
    },
    waitOutcome: {
      type: 'string',
      description:
        'Sim local wait outcome: incomplete means waiting stopped before observing completion. The last Oracle snapshot is retained; inspect jobId or Job Status links before any resubmission. This is not an Oracle status or cancellation.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_copy_data',
          'oracle_epm_tax_reporting_clear_data',
          'oracle_epm_tax_reporting_run_rule',
          'oracle_epm_tax_reporting_run_ruleset',
          'oracle_epm_tax_reporting_execute_job',
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_export_metadata',
          'oracle_epm_tax_reporting_import_metadata',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_get_report_status',
        ],
      },
    },
    detail: {
      type: 'string',
      description: 'Supplemental deployment details when returned under singular detail',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_job_status',
          'oracle_epm_tax_reporting_import_supplemental_collection_data',
          'oracle_epm_tax_reporting_deploy_form_templates',
          'oracle_epm_tax_reporting_import_supplemental_dimension_members',
        ],
      },
    },
    type: {
      type: 'string',
      description: 'Report or job type',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_generate_report',
          'oracle_epm_tax_reporting_generate_user_details_report',
          'oracle_epm_tax_reporting_get_report_status',
        ],
      },
    },
    file: {
      type: 'file',
      description:
        'Stored report as a canonical Sim UserFile when explicitly requested and complete',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_tax_reporting_get_report_status',
          'oracle_epm_tax_reporting_download_file',
        ],
      },
    },
  },
}

export const OracleEpmTaxReportingBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/performance-management/tax-reporting/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Run a tax automation rule',
      prompt:
        'Create a workflow that selects a deployed Tax Reporting rule, accepts the exact scenario, year, period, entity and jurisdiction runtime prompts supplied by the tax team, submits the rule once, and checks its job status before reporting completion.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Back up tax metadata',
      prompt:
        'Build a scheduled workflow that runs an existing Tax Reporting metadata export job, waits for success, and downloads its ZIP to a Sim file. Do not begin another export after an uncertain submission.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review rejected tax data cells',
      prompt:
        'Build a workflow that imports an approved bounded Tax Reporting data grid, separates accepted and rejected cells, and stores the first 100 rejection reasons for a tax analyst. Use Data Integration for general bulk imports.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Copy a configured tax reporting POV',
      prompt:
        'Create a workflow that runs a tax-team-approved copy data profile by name, records its job ID, and monitors completion. The saved profile, not inferred dimension names, defines the source and target POV.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Load supplemental collection data',
      prompt:
        'Build a workflow that uploads a validated Supplemental Data CSV, imports it into a named collection for an explicit year and period plus tenant frequency dimensions, then polls the supplemental collection job.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Deploy period form templates',
      prompt:
        'Create a workflow that accepts an explicit Supplemental Data collection interval and named templates, supplies its configured frequency dimensions, and deploys the templates without resetting workflows. Require deliberate approval before using an empty template list.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Generate a tax close report',
      prompt:
        'Build a workflow that generates an existing Task Manager report with all configured schedule and period parameters, follows the correct generated-report status family, and stores the completed report as a Sim file.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Audit tax reporting user assignments',
      prompt:
        'Create a scheduled workflow that generates a User Details CSV for Tax Reporting, checks the user-details report status family, downloads the report, and sends the authorized tax administrator a summary.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'run-tax-reporting-rules',
      description: 'Launch deployed tax rules and retain job identity.',
      content:
        '# Launch deployed tax rules and retain job identity.\n\n## Steps\n\n1. Select the application and a deployed RULES or RULESET definition.\n2. Obtain exact runtime prompt names and POV members from the tax team; never assume a universal tax automation rule name.\n3. Submit Run Rule or Run Ruleset once.\n4. Use Get Job Status in the planning family; -1 and cancellation-pending 2 are not completion.\n\n## Output\n\nReturn job ID, status, and any failure details. Local timeout does not cancel Oracle execution.\n\n## Reference\n\n[Oracle API documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/rules.html)',
    },
    {
      name: 'maintain-tax-metadata',
      description: 'Export and import saved metadata jobs with diagnostic follow-up.',
      content:
        '# Export and import saved metadata jobs with diagnostic follow-up.\n\n## Steps\n\n1. Use a saved export job and wait for success before downloading its ZIP.\n2. For an approved import, upload the ZIP first and run the saved import job.\n3. Refresh the cube only when intended.\n4. Read Get Job Details and child-job diagnostics for rejected metadata.\n\n## Output\n\nReturn file references and job results; never report successful submission as completed import.\n\n## Reference\n\n[Oracle API documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_metadata.html)',
    },
    {
      name: 'inspect-tax-data-slices',
      description: 'Read and validate a bounded tax data grid.',
      content:
        '# Read and validate a bounded tax data grid.\n\n## Steps\n\n1. Obtain the exact cube and dimension member names for the tenant.\n2. Export a narrow grid using explicit dimension names.\n3. Import only approved core cell values and inspect rejection counts and reasons.\n4. Use Data Integration for general bulk movement.\n\n## Output\n\nReturn accepted, updated and rejected counts; explain that cell notes and supporting details are outside this core grid interface.\n\n## Reference\n\n[Oracle API documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_dataslices.html)',
    },
    {
      name: 'generate-tax-close-reports',
      description: 'Generate configured close reports and download their output.',
      content:
        '# Generate configured close reports and download their output.\n\n## Steps\n\n1. Choose Task Manager FCM or Supplemental Data SDM and an existing report.\n2. Supply every parameter required by that report.\n3. Submit once, retaining the exact Job Status link and route family.\n4. Use Get Report Status with generated_report, or user_details for User Details exports, and request a file only after success.\n\n## Output\n\nReturn status and the canonical Sim file. The standalone /arm status route is documented separately and is not an alias.\n\n## Reference\n\n[Oracle API documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccstrcs_rest_generate_reports.html)',
    },
    {
      name: 'deploy-tax-supplemental-templates',
      description: 'Deploy a deliberate selection of collection forms.',
      content:
        '# Deploy a deliberate selection of collection forms.\n\n## Steps\n\n1. Confirm Supplemental Data is enabled and the collection interval already exists.\n2. Obtain its configured frequency dimension names and members.\n3. Supply named templates; an empty array deploys all templates.\n4. Leave resetWorkflows false unless resetting existing workflows is approved.\n\n## Output\n\nReturn the supplemental collection job ID and status.\n\n## Reference\n\n[Oracle API documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_deploy_form_templates.html)',
    },
    {
      name: 'import-tax-supplemental-members',
      description: 'Import supplemental dimensions without mixing application metadata APIs.',
      content:
        '# Import supplemental dimensions without mixing application metadata APIs.\n\n## Steps\n\n1. Upload the approved dimension CSV.\n2. Select the exact Supplemental Data dimension and import mode.\n3. Choose Update unless replacing members is explicitly intended; Oracle defaults to Replace.\n4. Poll Get Job Status with supplemental_dimension, which does not take an application.\n\n## Output\n\nReturn the SDM job status and retain the repository filename.\n\n## Reference\n\n[Oracle API documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/sdm_execute_jobs.html)',
    },
  ],
} as const satisfies BlockMeta
