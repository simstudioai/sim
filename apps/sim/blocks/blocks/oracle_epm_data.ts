import { utf8ByteLength } from '@sim/utils/paste'
import { NetSuiteIcon } from '@/components/icons'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'

function assertJsonInputSize(value: unknown, label: string): void {
  if (
    typeof value === 'string' &&
    utf8ByteLength(value, MAX_INLINE_MATERIALIZATION_BYTES) > MAX_INLINE_MATERIALIZATION_BYTES
  ) {
    throw new Error(`${label} exceeds the 16 MiB inline JSON limit`)
  }
}

function parseJson(value: unknown, label: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  assertJsonInputSize(value, label)
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

function optionalBoolean(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

export const OracleEpmDataBlock: BlockConfig = {
  type: 'oracle_epm_data',
  name: 'Oracle EPM Data Integration',
  description: 'Manage Data Integration jobs, mappings, pipelines, POVs, and repository files.',
  longDescription:
    'Use existing Oracle EPM Data Integration and Data Management configurations with 20 actions. Integration and pipeline submissions return opaque Oracle JSON without assumed completion or execution-ID fields. Other documented jobs support optional bounded waiting. File transfers are capped at 100 MiB. Snapshot import clears target data; connection updates, replacement modes, POV locks, and file deletion change provider state. Product-specific Planning, FCCS, Tax, and Profitability APIs are outside this block.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_data',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#C74634',
  icon: NetSuiteIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Oracle EPM Data Integration',
    sentences: {
      byOperation: {
        list_connections: ['List connections'],
        get_connection: [
          {
            text: 'Read connection',
            field: ['connectionSelector', 'manualConnectionName'],
            core: true,
          },
        ],
        update_connection: [
          {
            text: 'Update connection',
            field: 'sourceSystemName',
            core: true,
          },
        ],
        get_pipeline_details: [
          {
            text: 'Read pipeline definition',
            field: 'pipelineCode',
            core: true,
          },
        ],
        run_integration: [
          {
            text: 'Submit integration',
            field: 'jobName',
            core: true,
          },
          {
            text: 'for',
            field: 'periodName',
            core: true,
          },
        ],
        run_pipeline: [
          {
            text: 'Submit pipeline',
            field: 'pipelineCode',
            core: true,
          },
        ],
        run_data_rule: [
          {
            text: 'Run data rule',
            field: 'jobName',
            core: true,
          },
          {
            text: 'from',
            field: 'startPeriod',
            core: true,
          },
          {
            text: 'to',
            field: 'endPeriod',
            core: true,
          },
        ],
        run_batch: [
          {
            text: 'Run batch',
            field: 'jobName',
            core: true,
          },
        ],
        get_job_status: [
          {
            text: 'Read status of job',
            field: 'jobId',
            core: true,
          },
        ],
        execute_report: [
          {
            text: 'Generate report',
            field: 'jobName',
            core: true,
          },
          {
            text: 'as',
            field: 'reportFormatType',
          },
        ],
        import_mappings: [
          {
            text: 'Import mappings from',
            field: ['repositoryFileSelector', 'manualRepositoryFileName'],
            core: true,
          },
        ],
        export_mappings: [
          {
            text: 'Export mappings to',
            field: 'destinationFileName',
            core: true,
          },
        ],
        import_data_integration: [
          {
            text: 'Replace Data Integration data from',
            field: ['repositoryFileSelector', 'manualRepositoryFileName'],
            core: true,
          },
        ],
        export_data_integration: [
          {
            text: 'Back up Data Integration to',
            field: 'destinationFileName',
            core: true,
          },
        ],
        get_pov_status: [
          {
            text: 'Read POV status for',
            field: 'period',
            core: true,
          },
          {
            text: 'in category',
            field: 'category',
            core: true,
          },
        ],
        set_pov_lock: [
          {
            text: 'Set POV lock for',
            field: 'period',
            core: true,
          },
          {
            text: 'in category',
            field: 'category',
            core: true,
          },
          {
            text: 'to',
            field: 'lockOperation',
          },
        ],
        list_files: ['List repository files'],
        upload_file: [
          {
            text: 'Upload',
            field: ['uploadFile', 'fileRef'],
            core: true,
          },
          {
            text: 'to',
            field: 'destinationFileName',
            core: true,
          },
        ],
        download_file: [
          {
            text: 'Download',
            field: ['repositoryFileSelector', 'manualRepositoryFileName'],
            core: true,
          },
        ],
        delete_file: [
          {
            text: 'Delete',
            field: ['repositoryFileSelector', 'manualRepositoryFileName'],
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          id: 'list_connections',
          label: 'List Connections',
        },
        {
          id: 'get_connection',
          label: 'Get Connection',
        },
        {
          id: 'update_connection',
          label: 'Update Connection',
        },
        {
          id: 'get_pipeline_details',
          label: 'Get Pipeline Details',
        },
        {
          id: 'run_integration',
          label: 'Run Integration',
        },
        {
          id: 'run_pipeline',
          label: 'Run Pipeline',
        },
        {
          id: 'run_data_rule',
          label: 'Run Data Rule',
        },
        {
          id: 'run_batch',
          label: 'Run Batch',
        },
        {
          id: 'get_job_status',
          label: 'Get Job Status',
        },
        {
          id: 'execute_report',
          label: 'Execute Report',
        },
        {
          id: 'import_mappings',
          label: 'Import Mappings',
        },
        {
          id: 'export_mappings',
          label: 'Export Mappings',
        },
        {
          id: 'import_data_integration',
          label: 'Import Data Integration',
        },
        {
          id: 'export_data_integration',
          label: 'Export Data Integration',
        },
        {
          id: 'get_pov_status',
          label: 'Get POV Status',
        },
        {
          id: 'set_pov_lock',
          label: 'Set POV Lock',
        },
        {
          id: 'list_files',
          label: 'List Files',
        },
        {
          id: 'upload_file',
          label: 'Upload File',
        },
        {
          id: 'download_file',
          label: 'Download File',
        },
        {
          id: 'delete_file',
          label: 'Delete File',
        },
      ],
      value: () => 'list_connections',
    },
    {
      id: 'credential',
      title: 'Oracle EPM Account',
      type: 'oauth-input',
      serviceId: 'oracle-epm-data',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle EPM service account',
      required: true,
      requiredScopes: getScopesForService('oracle-epm-data'),
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
      id: 'connectionSelector',
      title: 'Connection',
      type: 'dropdown',
      selectorKey: 'oracle_epm_data.connections',
      serviceId: 'oracle-epm-data',
      canonicalParamId: 'connectionName',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['get_connection'],
      },
      required: true,
      dependsOn: ['credential'],
      placeholder: 'Select connection',
    },
    {
      id: 'manualConnectionName',
      title: 'Connection',
      type: 'short-input',
      canonicalParamId: 'connectionName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_connection'],
      },
      required: true,
      placeholder: 'Enter connection manually',
    },
    {
      id: 'repositoryFileSelector',
      title: 'Repository File',
      type: 'dropdown',
      selectorKey: 'oracle_epm_data.files',
      serviceId: 'oracle-epm-data',
      canonicalParamId: 'repositoryFileName',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'run_integration',
          'run_data_rule',
          'import_mappings',
          'import_data_integration',
          'download_file',
          'delete_file',
        ],
      },
      required: {
        field: 'operation',
        value: ['import_mappings', 'import_data_integration', 'download_file', 'delete_file'],
      },
      dependsOn: ['credential'],
      placeholder: 'Select existing repository file',
    },
    {
      id: 'manualRepositoryFileName',
      title: 'Repository File',
      type: 'short-input',
      canonicalParamId: 'repositoryFileName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'run_integration',
          'run_data_rule',
          'import_mappings',
          'import_data_integration',
          'download_file',
          'delete_file',
        ],
      },
      required: {
        field: 'operation',
        value: ['import_mappings', 'import_data_integration', 'download_file', 'delete_file'],
      },
      placeholder: 'Enter repository file manually',
    },
    {
      id: 'destinationFileName',
      title: 'Destination File',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['upload_file', 'export_mappings', 'export_data_integration'],
      },
      required: true,
      placeholder: 'Enter raw filename; mapping exports include outbox/',
    },
    {
      id: 'locationSelector',
      title: 'Location',
      type: 'dropdown',
      selectorKey: 'oracle_epm_data.locations',
      serviceId: 'oracle-epm-data',
      canonicalParamId: 'locationName',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['import_mappings', 'export_mappings', 'get_pov_status', 'set_pov_lock'],
      },
      required: (values) =>
        values?.operation === 'set_pov_lock'
          ? { field: 'lockType', value: 'location' }
          : { field: 'operation', value: 'export_mappings' },
      dependsOn: ['credential', 'application', 'period', 'category'],
      placeholder: 'Scoped POV suggestions; use manual mode if unavailable',
    },
    {
      id: 'manualLocationName',
      title: 'Location',
      type: 'short-input',
      canonicalParamId: 'locationName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['import_mappings', 'export_mappings', 'get_pov_status', 'set_pov_lock'],
      },
      required: (values) =>
        values?.operation === 'set_pov_lock'
          ? { field: 'lockType', value: 'location' }
          : { field: 'operation', value: 'export_mappings' },
      placeholder: 'Enter location manually',
    },
    {
      id: 'sourceSystemId',
      title: 'Source System ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['update_connection'],
      },
      required: {
        field: 'operation',
        value: ['update_connection'],
      },
      placeholder: 'Source-system ID returned by Get Connection',
    },
    {
      id: 'sourceSystemName',
      title: 'Source System Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['update_connection'],
      },
      required: {
        field: 'operation',
        value: ['update_connection'],
      },
      placeholder: 'Source-system connection name',
    },
    {
      id: 'sourceSystemType',
      title: 'Source System Type',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['update_connection'],
      },
      required: {
        field: 'operation',
        value: ['update_connection'],
      },
      placeholder: 'Source-system type returned by Get Connection',
    },
    {
      id: 'sourceSystemOptions',
      title: 'Connection Options',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['update_connection'],
      },
      required: {
        field: 'operation',
        value: ['update_connection'],
      },
      language: 'json',
      placeholder: '[{"optionName":"userName","optionValue":"..."}]',
    },
    {
      id: 'pipelineCode',
      title: 'Pipeline Code',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_pipeline_details', 'run_pipeline'],
      },
      required: {
        field: 'operation',
        value: ['get_pipeline_details', 'run_pipeline'],
      },
      placeholder: 'Immutable pipeline code, not display name; 3–30 alphanumeric characters',
    },
    {
      id: 'jobName',
      title: 'Job Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['run_integration', 'run_data_rule', 'run_batch', 'execute_report'],
      },
      required: {
        field: 'operation',
        value: ['run_integration', 'run_data_rule', 'run_batch', 'execute_report'],
      },
      placeholder: 'Existing Data Integration integration name',
    },
    {
      id: 'periodName',
      title: 'Period Expression',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['run_integration'],
      },
      required: {
        field: 'operation',
        value: ['run_integration'],
      },
      placeholder:
        'Oracle period expression, for example {Jan-20}, {Jan-20}{Mar-20}, {Jan#FY20}, or {GLOBAL_POV}',
    },
    {
      id: 'executionMode',
      title: 'Quick Mode Execution',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['run_integration'],
      },
      required: false,
      options: [
        {
          id: 'ASYNC',
          label: 'ASYNC',
        },
        {
          id: 'SYNC',
          label: 'SYNC',
        },
      ],
      mode: 'advanced',
    },
    {
      id: 'sourceFilters',
      title: 'Source Filters',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['run_integration'],
      },
      required: false,
      language: 'json',
      placeholder: '{"Parameter name":"value"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Tenant-defined English source filter names and string values. Unsupported for native file-based loads. Return ONLY the JSON object.',
        placeholder: 'Describe the configured parameters',
        generationType: 'json-object',
      },
      mode: 'advanced',
    },
    {
      id: 'targetOptions',
      title: 'Target Options',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['run_integration'],
      },
      required: false,
      language: 'json',
      placeholder: '{"Parameter name":"value"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Tenant-defined English target option names and string values Return ONLY the JSON object.',
        placeholder: 'Describe the configured parameters',
        generationType: 'json-object',
      },
      mode: 'advanced',
    },
    {
      id: 'variables',
      title: 'Pipeline Variables',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['run_pipeline'],
      },
      required: false,
      language: 'json',
      placeholder: '{"Parameter name":"value"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Configured pipeline variable names and string values; omitted variables retain tenant defaults Return ONLY the JSON object.',
        placeholder: 'Describe the configured parameters',
        generationType: 'json-object',
      },
      mode: 'advanced',
    },
    {
      id: 'startPeriod',
      title: 'Start Period',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['run_data_rule'],
      },
      required: {
        field: 'operation',
        value: ['run_data_rule'],
      },
      placeholder: 'First period defined in Data Management period mapping',
    },
    {
      id: 'endPeriod',
      title: 'End Period',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['run_data_rule'],
      },
      required: {
        field: 'operation',
        value: ['run_data_rule'],
      },
      placeholder: 'Last period defined in Data Management period mapping',
    },
    {
      id: 'waitForCompletion',
      title: 'Wait for Completion',
      type: 'switch',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'export_data_integration',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_job_status'],
      },
      required: {
        field: 'operation',
        value: ['get_job_status'],
      },
      placeholder:
        'Positive Data Integration process ID; snapshot import placeholder 0 is not usable',
    },
    {
      id: 'reportFormatType',
      title: 'Report Format',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['execute_report'],
      },
      required: {
        field: 'operation',
        value: ['execute_report'],
      },
      options: [
        {
          id: 'PDF',
          label: 'PDF',
        },
        {
          id: 'XLSX',
          label: 'XLSX',
        },
        {
          id: 'HTML',
          label: 'HTML',
        },
        {
          id: 'EXCEL',
          label: 'EXCEL',
        },
      ],
      value: () => 'PDF',
    },
    {
      id: 'parameters',
      title: 'Report Parameters',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['execute_report'],
      },
      required: {
        field: 'operation',
        value: ['execute_report'],
      },
      language: 'json',
      placeholder: '{"Parameter name":"value"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Report-specific parameter names and string values, such as Dimension Name, Category, Period, and Location Return ONLY the JSON object.',
        placeholder: 'Describe the configured parameters',
        generationType: 'json-object',
      },
    },
    {
      id: 'dimension',
      title: 'Dimension',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['import_mappings', 'export_mappings'],
      },
      required: {
        field: 'operation',
        value: ['import_mappings', 'export_mappings'],
      },
      placeholder: 'Dimension name, or ALL for all dimensions',
    },
    {
      id: 'validationMode',
      title: 'Validate Target Members',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['import_mappings'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'snapshotType',
      title: 'Snapshot Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['export_data_integration'],
      },
      required: {
        field: 'operation',
        value: ['export_data_integration'],
      },
      options: [
        {
          id: 'ALL',
          label: 'ALL',
        },
        {
          id: 'ALL_INCREMENTAL',
          label: 'ALL_INCREMENTAL',
        },
        {
          id: 'INCREMENTAL',
          label: 'INCREMENTAL',
        },
        {
          id: 'SETUP',
          label: 'SETUP',
        },
      ],
      value: () => 'SETUP',
    },
    {
      id: 'overwriteFile',
      title: 'Overwrite Snapshot',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['export_data_integration'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'period',
      title: 'POV Period',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_pov_status', 'set_pov_lock', 'import_mappings', 'export_mappings'],
      },
      required: {
        field: 'operation',
        value: ['get_pov_status', 'set_pov_lock'],
      },
      placeholder: 'Data Integration POV period',
    },
    {
      id: 'category',
      title: 'POV Category',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_pov_status', 'set_pov_lock', 'import_mappings', 'export_mappings'],
      },
      required: {
        field: 'operation',
        value: ['get_pov_status', 'set_pov_lock'],
      },
      placeholder: 'Configured POV category, such as Actual',
    },
    {
      id: 'application',
      title: 'Application',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_pov_status', 'set_pov_lock', 'import_mappings', 'export_mappings'],
      },
      required: {
        field: 'operation',
        value: 'set_pov_lock',
        and: {
          field: 'lockType',
          value: 'application',
        },
      },
      placeholder: 'Application whose POV status should be read',
    },
    {
      id: 'lockType',
      title: 'Lock Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['set_pov_lock'],
      },
      required: {
        field: 'operation',
        value: ['set_pov_lock'],
      },
      options: [
        {
          id: 'location',
          label: 'location',
        },
        {
          id: 'application',
          label: 'application',
        },
      ],
      value: () => 'location',
    },
    {
      id: 'lockOperation',
      title: 'Lock Operation',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['set_pov_lock'],
      },
      required: {
        field: 'operation',
        value: ['set_pov_lock'],
      },
      options: [
        {
          id: 'lock',
          label: 'lock',
        },
        {
          id: 'unlock',
          label: 'unlock',
        },
      ],
      value: () => 'lock',
    },
    {
      id: 'unlockByLocation',
      title: 'Unlock by Location',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'set_pov_lock',
        and: {
          field: 'lockType',
          value: 'application',
        },
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'extDirPath',
      title: 'Upload Directory',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['upload_file'],
      },
      required: false,
      placeholder:
        'Oracle upload directory such as inbox, inbox/subfolder, or outbox; omit to use repository root',
      mode: 'advanced',
    },
    {
      id: 'dataRuleImportMode',
      title: 'Import Mode',
      type: 'dropdown',
      options: [
        {
          id: 'APPEND',
          label: 'APPEND',
        },
        {
          id: 'REPLACE',
          label: 'REPLACE',
        },
        {
          id: 'RECALCULATE',
          label: 'RECALCULATE',
        },
        {
          id: 'NONE',
          label: 'NONE',
        },
      ],
      condition: {
        field: 'operation',
        value: 'run_data_rule',
      },
      required: true,
    },
    {
      id: 'integrationImportMode',
      title: 'Import Mode',
      type: 'dropdown',
      options: [
        {
          id: 'Append',
          label: 'Append',
        },
        {
          id: 'Replace',
          label: 'Replace',
        },
        {
          id: 'Map and Validate',
          label: 'Map and Validate',
        },
        {
          id: 'No Import',
          label: 'No Import',
        },
        {
          id: 'Direct',
          label: 'Direct',
        },
      ],
      condition: {
        field: 'operation',
        value: 'run_integration',
      },
      required: true,
    },
    {
      id: 'mappingImportMode',
      title: 'Import Mode',
      type: 'dropdown',
      options: [
        {
          id: 'MERGE',
          label: 'MERGE',
        },
        {
          id: 'REPLACE',
          label: 'REPLACE',
        },
      ],
      condition: {
        field: 'operation',
        value: 'import_mappings',
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'dataRuleExportMode',
      title: 'Export Mode',
      type: 'dropdown',
      options: [
        {
          id: 'STORE_DATA',
          label: 'STORE_DATA',
        },
        {
          id: 'ADD_DATA',
          label: 'ADD_DATA',
        },
        {
          id: 'SUBTRACT_DATA',
          label: 'SUBTRACT_DATA',
        },
        {
          id: 'REPLACE_DATA',
          label: 'REPLACE_DATA',
        },
        {
          id: 'REPLACE',
          label: 'REPLACE',
        },
        {
          id: 'MERGE',
          label: 'MERGE',
        },
        {
          id: 'NONE',
          label: 'NONE',
        },
      ],
      condition: {
        field: 'operation',
        value: 'run_data_rule',
      },
      required: true,
    },
    {
      id: 'integrationExportMode',
      title: 'Export Mode',
      type: 'dropdown',
      options: [
        {
          id: 'Merge',
          label: 'Merge',
        },
        {
          id: 'Replace',
          label: 'Replace',
        },
        {
          id: 'Accumulate',
          label: 'Accumulate',
        },
        {
          id: 'Subtract',
          label: 'Subtract',
        },
        {
          id: 'No Export',
          label: 'No Export',
        },
      ],
      condition: {
        field: 'operation',
        value: 'run_integration',
      },
      required: true,
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      mode: 'basic',
      multiple: false,
      maxSize: 100,
      required: true,
      condition: {
        field: 'operation',
        value: 'upload_file',
      },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      required: true,
      placeholder: 'Reference one UserFile from an earlier block',
      condition: {
        field: 'operation',
        value: 'upload_file',
      },
    },
  ],
  tools: {
    access: [
      'oracle_epm_data_list_connections',
      'oracle_epm_data_get_connection',
      'oracle_epm_data_update_connection',
      'oracle_epm_data_get_pipeline_details',
      'oracle_epm_data_run_integration',
      'oracle_epm_data_run_pipeline',
      'oracle_epm_data_run_data_rule',
      'oracle_epm_data_run_batch',
      'oracle_epm_data_get_job_status',
      'oracle_epm_data_execute_report',
      'oracle_epm_data_import_mappings',
      'oracle_epm_data_export_mappings',
      'oracle_epm_data_import_data_integration',
      'oracle_epm_data_export_data_integration',
      'oracle_epm_data_get_pov_status',
      'oracle_epm_data_set_pov_lock',
      'oracle_epm_data_list_files',
      'oracle_epm_data_upload_file',
      'oracle_epm_data_download_file',
      'oracle_epm_data_delete_file',
    ],
    config: {
      tool: (params) => `oracle_epm_data_${params.operation}`,
      params: (params) => {
        const operation = params.operation
        // Agent calls already use canonical typed tool inputs, without an editor operation.
        if (!operation) return params
        if (operation === 'upload_file') assertJsonInputSize(params.file, 'File Reference')
        const fileName = [
          'run_integration',
          'run_data_rule',
          'import_mappings',
          'import_data_integration',
          'download_file',
          'delete_file',
        ].includes(operation)
          ? params.repositoryFileName
          : params.destinationFileName
        return {
          ...params,
          fileName: fileName === '' ? undefined : fileName,
          file:
            operation === 'upload_file'
              ? normalizeFileInput(params.file, { single: true })
              : undefined,
          importMode:
            operation === 'run_integration'
              ? params.integrationImportMode
              : operation === 'run_data_rule'
                ? params.dataRuleImportMode
                : params.mappingImportMode || undefined,
          exportMode:
            operation === 'run_integration'
              ? params.integrationExportMode
              : params.dataRuleExportMode,
          variables:
            operation === 'run_pipeline'
              ? parseJson(params.variables, 'Pipeline Variables')
              : undefined,
          parameters:
            operation === 'execute_report'
              ? parseJson(params.parameters, 'Report Parameters')
              : undefined,
          sourceFilters:
            operation === 'run_integration'
              ? parseJson(params.sourceFilters, 'Source Filters')
              : undefined,
          targetOptions:
            operation === 'run_integration'
              ? parseJson(params.targetOptions, 'Target Options')
              : undefined,
          sourceSystemOptions:
            operation === 'update_connection'
              ? parseJson(params.sourceSystemOptions, 'Connection Options')
              : undefined,
          waitForCompletion: optionalBoolean(params.waitForCompletion),
          validationMode: optionalBoolean(params.validationMode),
          overwriteFile: optionalBoolean(params.overwriteFile),
          unlockByLocation:
            operation === 'set_pov_lock' && params.lockType === 'application'
              ? optionalBoolean(params.unlockByLocation)
              : undefined,
          executionMode: params.executionMode || undefined,
          extDirPath: params.extDirPath || undefined,
          locationName: params.locationName || undefined,
          application: params.application || undefined,
        }
      },
    },
  },
  inputs: {
    oauthCredential: {
      type: 'string',
      description: 'Selected Oracle EPM service-account credential',
    },
    connectionName: {
      type: 'string',
      description: 'Connection',
    },
    repositoryFileName: {
      type: 'string',
      description: 'Repository File',
    },
    destinationFileName: {
      type: 'string',
      description: 'Destination File',
    },
    locationName: {
      type: 'string',
      description: 'Location',
    },
    sourceSystemId: {
      type: 'string',
      description: 'Source System ID',
    },
    sourceSystemName: {
      type: 'string',
      description: 'Source System Name',
    },
    sourceSystemType: {
      type: 'string',
      description: 'Source System Type',
    },
    sourceSystemOptions: {
      type: 'json',
      description: 'Connection Options',
    },
    pipelineCode: {
      type: 'string',
      description: 'Pipeline Code',
    },
    jobName: {
      type: 'string',
      description: 'Job Name',
    },
    periodName: {
      type: 'string',
      description: 'Period Expression',
    },
    executionMode: {
      type: 'string',
      description: 'Quick Mode Execution',
    },
    sourceFilters: {
      type: 'json',
      description: 'Source Filters',
    },
    targetOptions: {
      type: 'json',
      description: 'Target Options',
    },
    variables: {
      type: 'json',
      description: 'Pipeline Variables',
    },
    startPeriod: {
      type: 'string',
      description: 'Start Period',
    },
    endPeriod: {
      type: 'string',
      description: 'End Period',
    },
    waitForCompletion: {
      type: 'boolean',
      description: 'Wait for Completion',
    },
    jobId: {
      type: 'string',
      description: 'Job ID',
    },
    reportFormatType: {
      type: 'string',
      description: 'Report Format',
    },
    parameters: {
      type: 'json',
      description: 'Report Parameters',
    },
    dimension: {
      type: 'string',
      description: 'Dimension',
    },
    validationMode: {
      type: 'boolean',
      description: 'Validate Target Members',
    },
    snapshotType: {
      type: 'string',
      description: 'Snapshot Type',
    },
    overwriteFile: {
      type: 'boolean',
      description: 'Overwrite Snapshot',
    },
    period: {
      type: 'string',
      description: 'POV Period',
    },
    category: {
      type: 'string',
      description: 'POV Category',
    },
    application: {
      type: 'string',
      description: 'Application',
    },
    lockType: {
      type: 'string',
      description: 'Lock Type',
    },
    lockOperation: {
      type: 'string',
      description: 'Lock Operation',
    },
    unlockByLocation: {
      type: 'boolean',
      description: 'Unlock by Location',
    },
    extDirPath: {
      type: 'string',
      description: 'Upload Directory',
    },
    dataRuleImportMode: {
      type: 'string',
      description: 'Import Mode',
    },
    integrationImportMode: {
      type: 'string',
      description: 'Import Mode',
    },
    mappingImportMode: {
      type: 'string',
      description: 'Import Mode',
    },
    dataRuleExportMode: {
      type: 'string',
      description: 'Export Mode',
    },
    integrationExportMode: {
      type: 'string',
      description: 'Export Mode',
    },
    file: {
      type: 'json',
      description: 'File',
    },
  },
  outputs: {
    httpStatus: {
      type: 'number',
      description: 'HTTP status returned by Oracle, distinct from Oracle job status',
      condition: {
        field: 'operation',
        value: [
          'list_connections',
          'get_connection',
          'update_connection',
          'get_pipeline_details',
          'run_integration',
          'run_pipeline',
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
          'get_pov_status',
          'set_pov_lock',
          'list_files',
          'upload_file',
          'download_file',
          'delete_file',
        ],
      },
    },
    status: {
      type: 'number',
      description: 'Oracle status code; HTTP success alone does not mean job completion',
      condition: {
        field: 'operation',
        value: [
          'list_connections',
          'get_connection',
          'update_connection',
          'get_pipeline_details',
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
          'get_pov_status',
          'set_pov_lock',
          'list_files',
          'upload_file',
          'delete_file',
        ],
      },
    },
    details: {
      type: 'string',
      description: 'Oracle operation or error details',
      condition: {
        field: 'operation',
        value: [
          'list_connections',
          'get_connection',
          'update_connection',
          'get_pipeline_details',
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
          'get_pov_status',
          'set_pov_lock',
          'list_files',
          'upload_file',
          'delete_file',
        ],
      },
    },
    connections: {
      type: 'json',
      description: 'Documented Data Integration connection names and references',
      condition: {
        field: 'operation',
        value: ['list_connections'],
      },
    },
    connection: {
      type: 'json',
      description: 'Connection definition and Oracle-returned options',
      condition: {
        field: 'operation',
        value: ['get_connection'],
      },
    },
    response: {
      type: 'string',
      description: 'Oracle confirmation message',
      condition: {
        field: 'operation',
        value: ['update_connection', 'set_pov_lock'],
      },
    },
    pipeline: {
      type: 'json',
      description: 'Pipeline definition, variables, stages, jobs, and latest execution metadata',
      condition: {
        field: 'operation',
        value: ['get_pipeline_details'],
      },
    },
    data: {
      type: 'json',
      description:
        'Uninterpreted Oracle submission JSON. No acceptance, completion, status, or job-ID field is assumed.',
      condition: {
        field: 'operation',
        value: ['run_integration', 'run_pipeline'],
      },
    },
    jobId: {
      type: 'string',
      description: 'Oracle process ID; snapshot imports return the non-pollable placeholder 0',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    jobName: {
      type: 'string',
      description: 'Job name when returned',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    jobStatus: {
      type: 'string',
      description: 'Provider job status text',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    descriptiveStatus: {
      type: 'string',
      description: 'Provider description of job status',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    logFileName: {
      type: 'string',
      description: 'Repository filename of the execution log',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    outputFileName: {
      type: 'string',
      description: 'Repository filename of generated output, when available',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    processType: {
      type: 'string',
      description: 'Oracle process type',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    executedBy: {
      type: 'string',
      description: 'User that executed the Oracle job',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    action: {
      type: 'string',
      description: 'Snapshot action, when returned',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    snapshotType: {
      type: 'string',
      description: 'Export snapshot type, when returned',
      condition: {
        field: 'operation',
        value: [
          'run_data_rule',
          'run_batch',
          'get_job_status',
          'execute_report',
          'import_mappings',
          'export_mappings',
          'import_data_integration',
          'export_data_integration',
        ],
      },
    },
    povs: {
      type: 'json',
      description: 'POV lock records; may include an application-summary record',
      condition: {
        field: 'operation',
        value: ['get_pov_status'],
      },
    },
    files: {
      type: 'json',
      description: 'Repository files and application snapshots',
      condition: {
        field: 'operation',
        value: ['list_files'],
      },
    },
    fileName: {
      type: 'string',
      description: 'Complete repository filename',
      condition: {
        field: 'operation',
        value: ['upload_file', 'download_file', 'delete_file'],
      },
    },
    file: {
      type: 'file',
      description: 'Downloaded UserFile stored in this workflow execution',
      condition: {
        field: 'operation',
        value: ['download_file'],
      },
    },
  },
}

export const OracleEpmDataBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/erp/performance-management/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Load an approved data file',
      prompt:
        'Build a workflow that uploads an approved UserFile to inbox, runs a predefined data rule for supplied start and end periods, waits for its documented job result, and reports success or failure.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Back up Data Integration',
      prompt:
        'Create a scheduled workflow that exports a SETUP snapshot with a unique filename, waits for its job, and downloads the resulting outbox file when it is within 100 MiB.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review member mappings',
      prompt:
        'Export ALL member mappings for a supplied location to an outbox CSV, wait for completion, and download the file for review.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Import approved mappings',
      prompt:
        'Upload an approved mapping file, import it into a supplied location in MERGE mode with target-member validation, and report its job result.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Generate a POV report',
      prompt:
        'Run a configured Data Management report with supplied POV parameters, wait for its job, and download its documented output file when available.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect pipeline configuration',
      prompt:
        'Read a pipeline by its immutable code and summarize its configured stages, jobs, variables, and latest execution metadata without running it.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Audit POV lock status',
      prompt:
        'On a schedule, read POV statuses for an application, period, and category and summarize locked and unlocked records without changing locks.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Run a configured batch',
      prompt:
        'Run a predefined Data Management batch with bounded completion waiting and retain its process ID for later status checks if waiting stops.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'load-data-file',
      description: 'Load an approved data file',
      content:
        '# Load an approved data file\n\nBuild a workflow that uploads an approved UserFile to inbox, runs a predefined data rule for supplied start and end periods, waits for its documented job result, and reports success or failure.\n\n## Steps\n1. Obtain the configured resource names, scope, and selected Oracle EPM credential from the user.\n2. Build a workflow that uploads an approved UserFile to inbox, runs a predefined data rule for supplied start and end periods, waits for its documented job result, and reports success or failure.\n3. Preserve Oracle status codes and returned filenames; never infer completion from HTTP success alone.\n\n## Output and guidance\nReport the documented result and any remaining manual checks. File transfers are limited to 100 MiB. Do not repeat a submitted job after a timeout.\n\nReference: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fdmee_run_data_rule.html',
    },
    {
      name: 'back-up-data-integration',
      description: 'Back up Data Integration',
      content:
        '# Back up Data Integration\n\nCreate a scheduled workflow that exports a SETUP snapshot with a unique filename, waits for its job, and downloads the resulting outbox file when it is within 100 MiB.\n\n## Steps\n1. Obtain the configured resource names, scope, and selected Oracle EPM credential from the user.\n2. Create a scheduled workflow that exports a SETUP snapshot with a unique filename, waits for its job, and downloads the resulting outbox file when it is within 100 MiB.\n3. Preserve Oracle status codes and returned filenames; never infer completion from HTTP success alone.\n\n## Output and guidance\nReport the documented result and any remaining manual checks. File transfers are limited to 100 MiB. Do not repeat a submitted job after a timeout.\n\nReference: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fdmee_export_data_snapshot.html',
    },
    {
      name: 'review-member-mappings',
      description: 'Review member mappings',
      content:
        '# Review member mappings\n\nExport ALL member mappings for a supplied location to an outbox CSV, wait for completion, and download the file for review.\n\n## Steps\n1. Obtain the configured resource names, scope, and selected Oracle EPM credential from the user.\n2. Export ALL member mappings for a supplied location to an outbox CSV, wait for completion, and download the file for review.\n3. Preserve Oracle status codes and returned filenames; never infer completion from HTTP success alone.\n\n## Output and guidance\nReport the documented result and any remaining manual checks. File transfers are limited to 100 MiB. Do not repeat a submitted job after a timeout.\n\nReference: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fdmee_export_data_mapping.html',
    },
    {
      name: 'validate-mapping-import',
      description: 'Import approved mappings',
      content:
        '# Import approved mappings\n\nUpload an approved mapping file, import it into a supplied location in MERGE mode with target-member validation, and report its job result.\n\n## Steps\n1. Obtain the configured resource names, scope, and selected Oracle EPM credential from the user.\n2. Upload an approved mapping file, import it into a supplied location in MERGE mode with target-member validation, and report its job result.\n3. Preserve Oracle status codes and returned filenames; never infer completion from HTTP success alone.\n\n## Output and guidance\nReport the documented result and any remaining manual checks. File transfers are limited to 100 MiB. Do not repeat a submitted job after a timeout.\n\nReference: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fdmee_import_data_mapping.html',
    },
    {
      name: 'generate-pov-report',
      description: 'Generate a POV report',
      content:
        '# Generate a POV report\n\nRun a configured Data Management report with supplied POV parameters, wait for its job, and download its documented output file when available.\n\n## Steps\n1. Obtain the configured resource names, scope, and selected Oracle EPM credential from the user.\n2. Run a configured Data Management report with supplied POV parameters, wait for its job, and download its documented output file when available.\n3. Preserve Oracle status codes and returned filenames; never infer completion from HTTP success alone.\n\n## Output and guidance\nReport the documented result and any remaining manual checks. File transfers are limited to 100 MiB. Do not repeat a submitted job after a timeout.\n\nReference: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fdmee_execute_report.html',
    },
    {
      name: 'inspect-pipeline-definition',
      description: 'Inspect pipeline configuration',
      content:
        '# Inspect pipeline configuration\n\nRead a pipeline by its immutable code and summarize its configured stages, jobs, variables, and latest execution metadata without running it.\n\n## Steps\n1. Obtain the configured resource names, scope, and selected Oracle EPM credential from the user.\n2. Read a pipeline by its immutable code and summarize its configured stages, jobs, variables, and latest execution metadata without running it.\n3. Preserve Oracle status codes and returned filenames; never infer completion from HTTP success alone.\n\n## Output and guidance\nReport the documented result and any remaining manual checks. File transfers are limited to 100 MiB. Do not repeat a submitted job after a timeout.\n\nReference: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_pipeline.html',
    },
  ],
} as const satisfies BlockMeta
