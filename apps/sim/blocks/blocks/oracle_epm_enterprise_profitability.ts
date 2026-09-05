import { NetSuiteIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { OracleEpcmResponse } from '@/tools/oracle_epm_enterprise_profitability/types'

export const OracleEpcmBlock: BlockConfig<OracleEpcmResponse> = {
  type: 'oracle_epm_enterprise_profitability',
  name: 'Oracle EPCM',
  description: 'Operate Enterprise Profitability models, POVs, allocations, jobs, and results',
  longDescription:
    'Connect an Oracle EPM service-account credential to Enterprise Profitability and Cost Management (EPCM). Run existing models and allocation rules, manage POV data, inspect members, monitor jobs, exchange data/metadata, and transfer ordinary repository files up to 100 MB. Model, POV, cube, dimension, and rule names are tenant-specific manual inputs. No legacy PCM APIs, model/rule CRUD, migrations, or snapshot workflows. Most operations require Service Administrator. Dynamic member creation requires an eligible parent and a prior cube refresh. Oracle documentation is inconsistent about EPCM job-definition discovery; verify availability in your tenant and use manual saved-job names where necessary.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_enterprise_profitability',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle EPCM',
    sentences: {
      byOperation: {
        oracle_epm_enterprise_profitability_list_applications: [
          'List accessible EPCM applications',
        ],
        oracle_epm_enterprise_profitability_get_member: [
          {
            text: 'Read member',
            field: 'memberName',
            core: true,
          },
          {
            text: 'in dimension',
            field: 'dimensionName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_add_member: [
          {
            text: 'Add member',
            field: 'memberName',
            core: true,
          },
          {
            text: 'under parent',
            field: 'parentName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_list_job_definitions: [
          {
            text: 'List saved jobs of type',
            field: 'jobType',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_generate_model_documentation: [
          {
            text: 'Document model',
            field: 'modelName',
            core: true,
          },
          {
            text: 'as',
            field: 'outputFileName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_validate_model: [
          {
            text: 'Validate model',
            field: 'modelName',
            core: true,
          },
          {
            text: 'and write',
            field: 'outputFileName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_calculate_model: [
          {
            text: 'Calculate model',
            field: 'modelName',
            core: true,
          },
          {
            text: 'for POV',
            field: 'povName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_clear_pov: [
          {
            text: 'Clear POV data for',
            field: 'povName',
            core: true,
          },
          {
            text: 'in cube',
            field: 'cubeName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_copy_pov: [
          {
            text: 'Copy POV',
            field: 'sourcePOVName',
            core: true,
          },
          {
            text: 'to',
            field: 'destPOVName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_delete_pov: [
          {
            text: 'Delete POV',
            field: 'povName',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_get_job_status: [
          {
            text: 'Check job',
            field: 'jobId',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_wait_for_job: [
          {
            text: 'Wait for job',
            field: 'jobId',
            core: true,
          },
          {
            text: 'for up to',
            field: 'maxWaitSeconds',
            core: false,
            after: 'seconds',
          },
        ],
        oracle_epm_enterprise_profitability_get_job_details: [
          {
            text: 'Read exchange diagnostics for job',
            field: 'jobId',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_get_child_job_details: [
          {
            text: 'Read messages for child job',
            field: 'childJobId',
            core: true,
          },
          {
            text: 'of',
            field: 'jobId',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_export_data_slice: [
          {
            text: 'Read a results grid from cube',
            field: 'cubeName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_import_data_slice: [
          {
            text: 'Write a data grid to cube',
            field: 'cubeName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_import_data: [
          {
            text: 'Import data into',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'from',
            field: ['repositoryFileSelector', 'repositoryFileManual'],
            core: false,
          },
        ],
        oracle_epm_enterprise_profitability_export_data: [
          {
            text: 'Export data from',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'to',
            field: 'outputFileName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_import_metadata: [
          {
            text: 'Import metadata with',
            field: ['jobDefinitionSelector', 'jobDefinitionManual'],
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_export_metadata: [
          {
            text: 'Export metadata with',
            field: ['jobDefinitionSelector', 'jobDefinitionManual'],
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_list_files: ['List ordinary EPCM repository files'],
        oracle_epm_enterprise_profitability_upload_file: [
          {
            text: 'Upload',
            field: ['fileUpload', 'fileReference'],
            core: true,
          },
          {
            text: 'as',
            field: 'outputFileName',
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_download_file: [
          {
            text: 'Download',
            field: ['repositoryFileSelector', 'repositoryFileManual'],
            core: true,
          },
        ],
        oracle_epm_enterprise_profitability_delete_file: [
          {
            text: 'Delete',
            field: ['repositoryFileSelector', 'repositoryFileManual'],
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
      serviceId: 'oracle-epm-enterprise-profitability',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle EPM Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Credential ID',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          id: 'oracle_epm_enterprise_profitability_list_applications',
          label: 'List Applications',
        },
        {
          id: 'oracle_epm_enterprise_profitability_get_member',
          label: 'Get Member',
        },
        {
          id: 'oracle_epm_enterprise_profitability_add_member',
          label: 'Add Member',
        },
        {
          id: 'oracle_epm_enterprise_profitability_list_job_definitions',
          label: 'List Job Definitions',
        },
        {
          id: 'oracle_epm_enterprise_profitability_generate_model_documentation',
          label: 'Generate Model Documentation',
        },
        {
          id: 'oracle_epm_enterprise_profitability_validate_model',
          label: 'Validate Model',
        },
        {
          id: 'oracle_epm_enterprise_profitability_calculate_model',
          label: 'Calculate Model',
        },
        {
          id: 'oracle_epm_enterprise_profitability_clear_pov',
          label: 'Clear POV Data',
        },
        {
          id: 'oracle_epm_enterprise_profitability_copy_pov',
          label: 'Copy POV Data',
        },
        {
          id: 'oracle_epm_enterprise_profitability_delete_pov',
          label: 'Delete POV',
        },
        {
          id: 'oracle_epm_enterprise_profitability_get_job_status',
          label: 'Get Job Status',
        },
        {
          id: 'oracle_epm_enterprise_profitability_wait_for_job',
          label: 'Wait for Job',
        },
        {
          id: 'oracle_epm_enterprise_profitability_get_job_details',
          label: 'Get Job Details',
        },
        {
          id: 'oracle_epm_enterprise_profitability_get_child_job_details',
          label: 'Get Child Job Details',
        },
        {
          id: 'oracle_epm_enterprise_profitability_export_data_slice',
          label: 'Export Data Slice',
        },
        {
          id: 'oracle_epm_enterprise_profitability_import_data_slice',
          label: 'Import Data Slice',
        },
        {
          id: 'oracle_epm_enterprise_profitability_import_data',
          label: 'Import Data',
        },
        {
          id: 'oracle_epm_enterprise_profitability_export_data',
          label: 'Export Data',
        },
        {
          id: 'oracle_epm_enterprise_profitability_import_metadata',
          label: 'Import Metadata',
        },
        {
          id: 'oracle_epm_enterprise_profitability_export_metadata',
          label: 'Export Metadata',
        },
        {
          id: 'oracle_epm_enterprise_profitability_list_files',
          label: 'List Repository Files',
        },
        {
          id: 'oracle_epm_enterprise_profitability_upload_file',
          label: 'Upload File',
        },
        {
          id: 'oracle_epm_enterprise_profitability_download_file',
          label: 'Download File',
        },
        {
          id: 'oracle_epm_enterprise_profitability_delete_file',
          label: 'Delete File',
        },
      ],
      value: () => 'oracle_epm_enterprise_profitability_list_applications',
      required: true,
    },
    {
      id: 'applicationSelector',
      title: 'Application',
      type: 'project-selector',
      canonicalParamId: 'applicationName',
      serviceId: 'oracle-epm-enterprise-profitability',
      selectorKey: 'oracleEpm.applications',
      mode: 'basic',
      dependsOn: ['oauthCredential'],
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
          'oracle_epm_enterprise_profitability_list_job_definitions',
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
          'oracle_epm_enterprise_profitability_export_data_slice',
          'oracle_epm_enterprise_profitability_import_data_slice',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
          'oracle_epm_enterprise_profitability_list_job_definitions',
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
          'oracle_epm_enterprise_profitability_export_data_slice',
          'oracle_epm_enterprise_profitability_import_data_slice',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      placeholder: 'Select application',
    },
    {
      id: 'applicationManual',
      title: 'Application',
      type: 'short-input',
      canonicalParamId: 'applicationName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
          'oracle_epm_enterprise_profitability_list_job_definitions',
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
          'oracle_epm_enterprise_profitability_export_data_slice',
          'oracle_epm_enterprise_profitability_import_data_slice',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
          'oracle_epm_enterprise_profitability_list_job_definitions',
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
          'oracle_epm_enterprise_profitability_export_data_slice',
          'oracle_epm_enterprise_profitability_import_data_slice',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      placeholder: 'Enter application or a reference',
    },
    {
      id: 'jobType',
      title: 'Exchange Job Type',
      type: 'dropdown',
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
      value: () => 'IMPORT_DATA',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_list_job_definitions'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_list_job_definitions'],
      },
    },
    {
      id: 'jobDefinitionSelector',
      title: 'Saved Exchange Job',
      type: 'project-selector',
      canonicalParamId: 'jobName',
      serviceId: 'oracle-epm-enterprise-profitability',
      selectorKey: 'oracleEpm.jobDefinitions',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'applicationName', 'operation', 'jobType'],
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      placeholder: 'Select saved exchange job',
    },
    {
      id: 'jobDefinitionManual',
      title: 'Saved Exchange Job',
      type: 'short-input',
      canonicalParamId: 'jobName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
      placeholder: 'Enter saved exchange job or a reference',
    },
    {
      id: 'jobLabel',
      title: 'Job Label',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
        ],
      },
      placeholder: 'Workflow calculation run',
      description: 'A label is required; an existing saved calculation/POV job is not required.',
    },
    {
      id: 'repositoryFileSelector',
      title: 'Repository File',
      type: 'project-selector',
      canonicalParamId: 'repositoryFileName',
      serviceId: 'oracle-epm-enterprise-profitability',
      selectorKey: 'oracleEpm.repositoryFiles',
      mode: 'basic',
      dependsOn: ['oauthCredential'],
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_download_file',
          'oracle_epm_enterprise_profitability_delete_file',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_download_file',
          'oracle_epm_enterprise_profitability_delete_file',
        ],
      },
      placeholder: 'Select repository file',
    },
    {
      id: 'repositoryFileManual',
      title: 'Repository File',
      type: 'short-input',
      canonicalParamId: 'repositoryFileName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_download_file',
          'oracle_epm_enterprise_profitability_delete_file',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_download_file',
          'oracle_epm_enterprise_profitability_delete_file',
        ],
      },
      placeholder: 'Enter repository file or a reference',
    },
    {
      id: 'outputFileName',
      title: 'Output / Upload Filename',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_export_metadata',
          'oracle_epm_enterprise_profitability_upload_file',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_upload_file',
        ],
      },
      placeholder: 'report.zip',
      description:
        'Raw filename; do not URL-encode. Export jobs may replace existing output files. Upload rejects existing names.',
    },
    {
      id: 'fileUpload',
      title: 'Source File',
      type: 'file-upload',
      canonicalParamId: 'file',
      mode: 'basic',
      maxSize: 100,
      multiple: false,
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_upload_file'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_upload_file'],
      },
    },
    {
      id: 'fileReference',
      title: 'Source File',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_upload_file'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_upload_file'],
      },
      placeholder: 'Canonical Sim file reference',
    },
    {
      id: 'dimensionName',
      title: 'Dimension Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
        ],
      },
      description: 'Exact dimension name',
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
        ],
      },
    },
    {
      id: 'memberName',
      title: 'Member Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
        ],
      },
      description: 'Exact member name',
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
        ],
      },
    },
    {
      id: 'parentName',
      title: 'Parent Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_add_member'],
      },
      description: 'Parent enabled for dynamic children',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_add_member'],
      },
    },
    {
      id: 'modelName',
      title: 'Model Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
        ],
      },
      description: "Existing EPCM model name; use the tenant's exact name",
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
        ],
      },
    },
    {
      id: 'outputType',
      title: 'Output Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_generate_model_documentation'],
      },
      description: 'Report output format',
      options: [
        {
          id: 'PDF',
          label: 'PDF',
        },
        {
          id: 'Word',
          label: 'Word',
        },
        {
          id: 'Excel',
          label: 'Excel',
        },
        {
          id: 'HTML',
          label: 'HTML',
        },
        {
          id: 'XML',
          label: 'XML',
        },
      ],
      value: () => 'PDF',
    },
    {
      id: 'ruleStatus',
      title: 'Rule Status',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_validate_model'],
      },
      description: "Rules to validate; uses Oracle's parameter-table casing",
      options: [
        {
          id: 'All',
          label: 'All',
        },
        {
          id: 'Enabled',
          label: 'Enabled',
        },
        {
          id: 'Disabled',
          label: 'Disabled',
        },
      ],
      value: () => 'All',
    },
    {
      id: 'povDelimiter',
      title: 'Pov Delimiter',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
        ],
      },
      description: 'Explicit single-character POV delimiter: _, #, ~, %, ;, :, or -',
      value: () => ':',
    },
    {
      id: 'povName',
      title: 'Pov Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
        ],
      },
      description:
        'POV members joined with the delimiter; calculations also accept comma-separated POVs',
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
        ],
      },
    },
    {
      id: 'executionType',
      title: 'Execution Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
      },
      description: 'Calculation execution scope',
      options: [
        {
          id: 'ALL_RULES',
          label: 'ALL_RULES',
        },
        {
          id: 'RULESET_SUBSET',
          label: 'RULESET_SUBSET',
        },
        {
          id: 'SINGLE_RULE',
          label: 'SINGLE_RULE',
        },
        {
          id: 'RUN_FROM_RULE',
          label: 'RUN_FROM_RULE',
        },
        {
          id: 'STOP_AFTER_RULE',
          label: 'STOP_AFTER_RULE',
        },
      ],
      value: () => 'ALL_RULES',
    },
    {
      id: 'ruleName',
      title: 'Rule Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
        and: {
          field: 'executionType',
          value: ['SINGLE_RULE', 'RUN_FROM_RULE', 'STOP_AFTER_RULE'],
        },
      },
      description: 'Required for SINGLE_RULE, RUN_FROM_RULE, or STOP_AFTER_RULE',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
        and: {
          field: 'executionType',
          value: ['SINGLE_RULE', 'RUN_FROM_RULE', 'STOP_AFTER_RULE'],
        },
      },
    },
    {
      id: 'rulesetSeqNumStart',
      title: 'Ruleset Seq Num Start',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
        and: {
          field: 'executionType',
          value: 'RULESET_SUBSET',
        },
      },
      description: 'Required first rule-set sequence for RULESET_SUBSET',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
        and: {
          field: 'executionType',
          value: 'RULESET_SUBSET',
        },
      },
    },
    {
      id: 'rulesetSeqNumEnd',
      title: 'Ruleset Seq Num End',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
        and: {
          field: 'executionType',
          value: 'RULESET_SUBSET',
        },
      },
      description: 'Required last rule-set sequence for RULESET_SUBSET',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
        and: {
          field: 'executionType',
          value: 'RULESET_SUBSET',
        },
      },
    },
    {
      id: 'clearCalculatedData',
      title: 'Clear Calculated Data',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
      },
      description: 'Clear previously calculated data',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'false',
    },
    {
      id: 'executeCalculations',
      title: 'Execute Calculations',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
      },
      description: 'Execute calculations; Sim explicitly defaults to true',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'true',
    },
    {
      id: 'optimizeForReporting',
      title: 'Optimize For Reporting',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
      },
      description: 'Optimize results for reporting',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'false',
    },
    {
      id: 'captureDebugScripts',
      title: 'Capture Debug Scripts',
      type: 'dropdown',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
      },
      description: 'Capture debug scripts',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'false',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_calculate_model'],
      },
      description: 'Optional calculation comment',
    },
    {
      id: 'cubeName',
      title: 'Cube Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_export_data_slice',
          'oracle_epm_enterprise_profitability_import_data_slice',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
        ],
      },
      description: 'Exact cube name',
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_export_data_slice',
          'oracle_epm_enterprise_profitability_import_data_slice',
        ],
      },
    },
    {
      id: 'clearInput',
      title: 'Clear Input',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_clear_pov'],
      },
      description: 'Clear input data',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'false',
    },
    {
      id: 'clearAllocatedValues',
      title: 'Clear Allocated Values',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_clear_pov'],
      },
      description: 'Clear allocated values',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'false',
    },
    {
      id: 'clearAdjustmentValues',
      title: 'Clear Adjustment Values',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_clear_pov'],
      },
      description: 'Clear adjustment values',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'false',
    },
    {
      id: 'sourcePOVName',
      title: 'Source POV',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
      description: 'Source POV members joined with the delimiter',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
    },
    {
      id: 'destPOVName',
      title: 'Destination POV',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
      description: 'Destination POV members joined with the delimiter',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
    },
    {
      id: 'sourceCubeName',
      title: 'Source Cube Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
      description: 'Source cube',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
    },
    {
      id: 'destCubeName',
      title: 'Dest Cube Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
      description: 'Destination cube',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
    },
    {
      id: 'copyType',
      title: 'Copy Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
      description: 'Copy all data or only input data',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_copy_pov'],
      },
      options: [
        {
          id: 'ALL_DATA',
          label: 'ALL_DATA',
        },
        {
          id: 'INPUT',
          label: 'INPUT',
        },
      ],
      value: () => 'ALL_DATA',
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
      description: 'Oracle job ID returned by a submission',
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
    },
    {
      id: 'maxWaitSeconds',
      title: 'Max Wait Seconds',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_wait_for_job'],
      },
      description: 'Maximum local wait, 1–3600 seconds; also bounded by the execution deadline',
      value: () => '300',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
      description: 'Zero-based diagnostic offset',
      value: () => '0',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
      description: 'One diagnostic page, 1–1000 items',
      value: () => '25',
    },
    {
      id: 'messageType',
      title: 'Message Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
      description: 'Optional message filter: ERROR, WARNING, or INFO',
      options: [
        {
          id: '',
          label: 'Use saved/default setting',
        },
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
      value: () => '',
    },
    {
      id: 'childJobId',
      title: 'Child Job ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_get_child_job_details'],
      },
      description: 'Validated child job ID returned by Get Job Details',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_get_child_job_details'],
      },
    },
    {
      id: 'gridDefinition',
      title: 'Grid Definition',
      type: 'code',
      wandConfig: {
        enabled: true,
        prompt: `Format the user's explicitly supplied EPCM dimension and member selections as an export gridDefinition JSON object. Use pov as an object and rows and columns as arrays of objects, each with members (string[][]) and optional dimensions (string[]). Preserve exact tenant names and their axis order. Do not invent dimensions, members, or financial values. Return only JSON without markdown.`,
        placeholder: 'Provide the exact dimensions and members for POV, rows, and columns',
      },
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data_slice'],
      },
      description:
        'Grid definition with pov, rows, and columns axes; each axis has members (string[][]) and optional dimensions. Example: {"pov":{"dimensions":["Scenario"],"members":[["Actual"]]},"rows":[{"dimensions":["Account"],"members":[["Net Income"]]}],"columns":[{"dimensions":["Period"],"members":[["Jan"]]}]}',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data_slice'],
      },
      placeholder:
        '{"pov":{"dimensions":["Scenario"],"members":[["Actual"]]},"rows":[{"dimensions":["Account"],"members":[["Net Income"]]}],"columns":[{"dimensions":["Period"],"members":[["Jan"]]}]}',
      language: 'json',
    },
    {
      id: 'dataGrid',
      title: 'Data Grid',
      type: 'code',
      wandConfig: {
        enabled: true,
        prompt: `Format the user's explicitly supplied EPCM cells as a dataGrid JSON object with pov (string[]), columns (string[][]), and rows containing headers (string[]) and data (strings or numbers). Preserve member order and cell values exactly, including decimal strings and missing-value markers. Do not invent dimensions, members, or values. Return only JSON without markdown.`,
        placeholder: 'Provide the exact POV, column members, row headers, and cell values',
      },
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
      description:
        'Grid with pov (string[]), columns (string[][]), and rows containing headers (string[]) and data (strings/numbers). Example: {"pov":["Actual"],"columns":[["Jan"]],"rows":[{"headers":["Revenue"],"data":["125.00"]}]}',
      required: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
      placeholder:
        '{"pov":["Actual"],"columns":[["Jan"]],"rows":[{"headers":["Revenue"],"data":["125.00"]}]}',
      language: 'json',
    },
    {
      id: 'aggregateEssbaseData',
      title: 'Aggregate Essbase Data',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
      description: 'Add values to existing data instead of overwriting',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'false',
    },
    {
      id: 'dateFormat',
      title: 'Date Format',
      type: 'dropdown',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
      description: 'Date format for date cells',
      options: [
        {
          id: '',
          label: 'Use saved/default setting',
        },
        {
          id: 'MM-DD-YYYY',
          label: 'MM-DD-YYYY',
        },
        {
          id: 'DD-MM-YYYY',
          label: 'DD-MM-YYYY',
        },
        {
          id: 'YYYY-MM-DD',
          label: 'YYYY-MM-DD',
        },
        {
          id: 'MM/DD/YYYY',
          label: 'MM/DD/YYYY',
        },
        {
          id: 'DD/MM/YYYY',
          label: 'DD/MM/YYYY',
        },
        {
          id: 'YYYY/MM/DD',
          label: 'YYYY/MM/DD',
        },
      ],
      value: () => '',
    },
    {
      id: 'strictDateValidation',
      title: 'Strict Date Validation',
      mode: 'advanced',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
      description: 'Reject invalid dates',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => 'true',
    },
    {
      id: 'sourceType',
      title: 'Source Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data'],
      },
      description: 'Required for an ad hoc import',
      options: [
        {
          id: '',
          label: 'Use saved/default setting',
        },
        {
          id: 'Planning',
          label: 'Planning',
        },
        {
          id: 'Essbase',
          label: 'Essbase',
        },
      ],
      value: () => '',
    },
    {
      id: 'delimiter',
      title: 'Delimiter',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
        ],
      },
      description: 'Planning-format file delimiter',
      options: [
        {
          id: '',
          label: 'Use saved/default setting',
        },
        {
          id: 'comma',
          label: 'comma',
        },
        {
          id: 'tab',
          label: 'tab',
        },
      ],
      value: () => '',
    },
    {
      id: 'includeMetaData',
      title: 'Include Meta Data',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data'],
      },
      description: 'Include metadata from a Planning-format file',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => '',
    },
    {
      id: 'stopOnError',
      title: 'Stop On Error',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data'],
      },
      description: 'Stop on intermediate Essbase import errors',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => '',
    },
    {
      id: 'rowMembers',
      title: 'Row Members',
      type: 'long-input',
      wandConfig: {
        enabled: true,
        prompt: `Format the user's explicitly supplied EPCM export row selections as a comma-separated member list, for example Revenue,Expenses, or preserve a supplied expression such as ILvl0Descendants(&RowMembers). Preserve exact tenant names, expressions, and substitution variables. Do not invent selections. Return only the list or expression, without JSON quotes, markdown, or explanation.`,
        placeholder: 'Provide the exact row members or member expression',
      },
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data'],
      },
      description: 'Row members or supported member expressions; required for an ad hoc export',
    },
    {
      id: 'columnMembers',
      title: 'Column Members',
      type: 'long-input',
      wandConfig: {
        enabled: true,
        prompt: `Format the user's explicitly supplied EPCM export column selections as a comma-separated member list, for example Jan,Feb, or preserve a supplied expression such as ILvl0Descendants(&ColumnMembers). Preserve exact tenant names, expressions, and substitution variables. Do not invent selections. Return only the list or expression, without JSON quotes, markdown, or explanation.`,
        placeholder: 'Provide the exact column members or member expression',
      },
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data'],
      },
      description: 'Column members or supported member expressions; required for an ad hoc export',
    },
    {
      id: 'povMembers',
      title: 'POV Members',
      type: 'long-input',
      wandConfig: {
        enabled: true,
        prompt: `Format the user's explicitly supplied EPCM export POV selections as a comma-separated member list, for example Actual,FY26,Working,&Entity. Preserve exact tenant names, member expressions, substitution variables, and dimension order. Do not invent selections. Return only the list or expression, without JSON quotes, markdown, or explanation.`,
        placeholder: 'Provide the exact POV members in cube dimension order',
      },
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data'],
      },
      description: 'POV members or supported member expressions; required for an ad hoc export',
    },
    {
      id: 'includeDynamicMembers',
      title: 'Include Dynamic Members',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data'],
      },
      description: 'Include dynamic members',
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => '',
    },
    {
      id: 'exportDataDecimalScale',
      title: 'Export Data Decimal Scale',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data'],
      },
      description: 'Optional decimal formatting, 0–16; omit to preserve Essbase precision',
    },
    {
      id: 'refreshCube',
      title: 'Refresh Cube',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_metadata'],
      },
      description: "Override the saved job's cube refresh option",
      options: [
        {
          id: '',
          label: 'Use default',
        },
        {
          id: 'true',
          label: 'Yes',
        },
        {
          id: 'false',
          label: 'No',
        },
      ],
      value: () => '',
    },
    {
      id: 'diagnosticJobType',
      title: 'Diagnostic Job Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
      options: ({ values } = { values: {} }) =>
        (values.operation === 'oracle_epm_enterprise_profitability_get_child_job_details'
          ? ['IMPORT_METADATA', 'EXPORT_METADATA']
          : ['IMPORT_DATA', 'EXPORT_DATA', 'IMPORT_METADATA', 'EXPORT_METADATA']
        ).map((id) => ({ id, label: id })),
      value: () => 'IMPORT_METADATA',
    },
  ],
  tools: {
    access: [
      'oracle_epm_enterprise_profitability_list_applications',
      'oracle_epm_enterprise_profitability_get_member',
      'oracle_epm_enterprise_profitability_add_member',
      'oracle_epm_enterprise_profitability_list_job_definitions',
      'oracle_epm_enterprise_profitability_generate_model_documentation',
      'oracle_epm_enterprise_profitability_validate_model',
      'oracle_epm_enterprise_profitability_calculate_model',
      'oracle_epm_enterprise_profitability_clear_pov',
      'oracle_epm_enterprise_profitability_copy_pov',
      'oracle_epm_enterprise_profitability_delete_pov',
      'oracle_epm_enterprise_profitability_get_job_status',
      'oracle_epm_enterprise_profitability_wait_for_job',
      'oracle_epm_enterprise_profitability_get_job_details',
      'oracle_epm_enterprise_profitability_get_child_job_details',
      'oracle_epm_enterprise_profitability_export_data_slice',
      'oracle_epm_enterprise_profitability_import_data_slice',
      'oracle_epm_enterprise_profitability_import_data',
      'oracle_epm_enterprise_profitability_export_data',
      'oracle_epm_enterprise_profitability_import_metadata',
      'oracle_epm_enterprise_profitability_export_metadata',
      'oracle_epm_enterprise_profitability_list_files',
      'oracle_epm_enterprise_profitability_upload_file',
      'oracle_epm_enterprise_profitability_download_file',
      'oracle_epm_enterprise_profitability_delete_file',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        if (typeof params.operation !== 'string') return params
        const {
          operation,
          jobLabel,
          repositoryFileName,
          outputFileName,
          jobType,
          diagnosticJobType,
          ...rest
        } = params
        const exchange = [
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ].includes(operation)
        return {
          ...rest,
          jobName: exchange ? rest.jobName : jobLabel,
          fileName: [
            'oracle_epm_enterprise_profitability_import_data',
            'oracle_epm_enterprise_profitability_import_metadata',
            'oracle_epm_enterprise_profitability_download_file',
            'oracle_epm_enterprise_profitability_delete_file',
          ].includes(operation)
            ? repositoryFileName
            : outputFileName,
          jobType:
            operation === 'oracle_epm_enterprise_profitability_list_job_definitions'
              ? jobType
              : diagnosticJobType,
        }
      },
    },
  },
  inputs: {
    jobLabel: { type: 'string', description: 'Required model/report/POV job label' },
    repositoryFileName: {
      type: 'string',
      description: 'Selected or manually specified ordinary repository file',
    },
    outputFileName: { type: 'string', description: 'Output report, export, or uploaded filename' },
    diagnosticJobType: { type: 'string', description: 'Supported diagnostic job family' },
    operation: {
      type: 'string',
      description: 'Selected EPCM action',
    },
    oauthCredential: {
      type: 'string',
      description: 'Oracle EPM service-account credential',
    },
    applicationName: {
      type: 'string',
      description: 'Exact EPCM application name',
    },
    dimensionName: {
      type: 'string',
      description: 'Exact dimension name',
    },
    memberName: {
      type: 'string',
      description: 'Exact member name',
    },
    parentName: {
      type: 'string',
      description: 'Parent enabled for dynamic children',
    },
    jobType: {
      type: 'string',
      description: 'Supported saved exchange job type',
    },
    jobName: {
      type: 'string',
      description: 'Calculation/report/POV job label; an existing saved job is not required',
    },
    modelName: {
      type: 'string',
      description: "Existing EPCM model name; use the tenant's exact name",
    },
    fileName: {
      type: 'string',
      description: 'Output report filename in the repository',
    },
    outputType: {
      type: 'string',
      description: 'Report output format',
    },
    ruleStatus: {
      type: 'string',
      description: "Rules to validate; uses Oracle's parameter-table casing",
    },
    povDelimiter: {
      type: 'string',
      description: 'Explicit single-character POV delimiter: _, #, ~, %, ;, :, or -',
    },
    povName: {
      type: 'string',
      description:
        'POV members joined with the delimiter; calculations also accept comma-separated POVs',
    },
    executionType: {
      type: 'string',
      description: 'Calculation execution scope',
    },
    ruleName: {
      type: 'string',
      description: 'Required for SINGLE_RULE, RUN_FROM_RULE, or STOP_AFTER_RULE',
    },
    rulesetSeqNumStart: {
      type: 'number',
      description: 'Required first rule-set sequence for RULESET_SUBSET',
    },
    rulesetSeqNumEnd: {
      type: 'number',
      description: 'Required last rule-set sequence for RULESET_SUBSET',
    },
    clearCalculatedData: {
      type: 'boolean',
      description: 'Clear previously calculated data',
    },
    executeCalculations: {
      type: 'boolean',
      description: 'Execute calculations; Sim explicitly defaults to true',
    },
    optimizeForReporting: {
      type: 'boolean',
      description: 'Optimize results for reporting',
    },
    captureDebugScripts: {
      type: 'boolean',
      description: 'Capture debug scripts',
    },
    comment: {
      type: 'string',
      description: 'Optional calculation comment',
    },
    cubeName: {
      type: 'string',
      description: 'Exact cube name',
    },
    clearInput: {
      type: 'boolean',
      description: 'Clear input data',
    },
    clearAllocatedValues: {
      type: 'boolean',
      description: 'Clear allocated values',
    },
    clearAdjustmentValues: {
      type: 'boolean',
      description: 'Clear adjustment values',
    },
    sourcePOVName: {
      type: 'string',
      description: 'Source POV members joined with the delimiter',
    },
    destPOVName: {
      type: 'string',
      description: 'Destination POV members joined with the delimiter',
    },
    sourceCubeName: {
      type: 'string',
      description: 'Source cube',
    },
    destCubeName: {
      type: 'string',
      description: 'Destination cube',
    },
    copyType: {
      type: 'string',
      description: 'Copy all data or only input data',
    },
    jobId: {
      type: 'string',
      description: 'Oracle job ID returned by a submission',
    },
    maxWaitSeconds: {
      type: 'number',
      description: 'Maximum local wait, 1–3600 seconds; also bounded by the execution deadline',
    },
    offset: {
      type: 'number',
      description: 'Zero-based diagnostic offset',
    },
    limit: {
      type: 'number',
      description: 'One diagnostic page, 1–1000 items',
    },
    messageType: {
      type: 'string',
      description: 'Optional message filter: ERROR, WARNING, or INFO',
    },
    childJobId: {
      type: 'string',
      description: 'Validated child job ID returned by Get Job Details',
    },
    gridDefinition: {
      type: 'json',
      description:
        'Grid definition with pov, rows, and columns axes; each axis has members (string[][]) and optional dimensions. Example: {"pov":{"dimensions":["Scenario"],"members":[["Actual"]]},"rows":[{"dimensions":["Account"],"members":[["Net Income"]]}],"columns":[{"dimensions":["Period"],"members":[["Jan"]]}]}',
    },
    dataGrid: {
      type: 'json',
      description:
        'Grid with pov (string[]), columns (string[][]), and rows containing headers (string[]) and data (strings/numbers). Example: {"pov":["Actual"],"columns":[["Jan"]],"rows":[{"headers":["Revenue"],"data":["125.00"]}]}',
    },
    aggregateEssbaseData: {
      type: 'boolean',
      description: 'Add values to existing data instead of overwriting',
    },
    dateFormat: {
      type: 'string',
      description: 'Date format for date cells',
    },
    strictDateValidation: {
      type: 'boolean',
      description: 'Reject invalid dates',
    },
    sourceType: {
      type: 'string',
      description: 'Required for an ad hoc import',
    },
    delimiter: {
      type: 'string',
      description: 'Planning-format file delimiter',
    },
    includeMetaData: {
      type: 'boolean',
      description: 'Include metadata from a Planning-format file',
    },
    stopOnError: {
      type: 'boolean',
      description: 'Stop on intermediate Essbase import errors',
    },
    rowMembers: {
      type: 'string',
      description: 'Row members or supported member expressions; required for an ad hoc export',
    },
    columnMembers: {
      type: 'string',
      description: 'Column members or supported member expressions; required for an ad hoc export',
    },
    povMembers: {
      type: 'string',
      description: 'POV members or supported member expressions; required for an ad hoc export',
    },
    includeDynamicMembers: {
      type: 'boolean',
      description: 'Include dynamic members',
    },
    exportDataDecimalScale: {
      type: 'number',
      description: 'Optional decimal formatting, 0–16; omit to preserve Essbase precision',
    },
    refreshCube: {
      type: 'boolean',
      description: "Override the saved job's cube refresh option",
    },
    file: {
      type: 'file',
      description: 'One canonical Sim UserFile (or one-element file-upload array)',
    },
  },
  outputs: {
    applications: {
      type: 'array',
      description: 'Accessible applications',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_list_applications'],
      },
    },
    member: {
      type: 'json',
      description: 'Documented member properties',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_member',
          'oracle_epm_enterprise_profitability_add_member',
        ],
      },
    },
    jobDefinitions: {
      type: 'array',
      description: 'Saved exchange jobs',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_list_job_definitions'],
      },
    },
    jobId: {
      type: 'string',
      description: 'Oracle job ID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
    },
    status: {
      type: 'number',
      description: 'Oracle job or repository status',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
          'oracle_epm_enterprise_profitability_upload_file',
          'oracle_epm_enterprise_profitability_delete_file',
        ],
      },
    },
    state: {
      type: 'string',
      description: 'Normalized Oracle job state',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
    },
    jobName: {
      type: 'string',
      description: 'Oracle job name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
    },
    descriptiveStatus: {
      type: 'string',
      description: 'Oracle descriptive status',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
        ],
      },
    },
    details: {
      type: 'json',
      description: 'Oracle job details or one page of exchange diagnostics',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_generate_model_documentation',
          'oracle_epm_enterprise_profitability_validate_model',
          'oracle_epm_enterprise_profitability_calculate_model',
          'oracle_epm_enterprise_profitability_clear_pov',
          'oracle_epm_enterprise_profitability_copy_pov',
          'oracle_epm_enterprise_profitability_delete_pov',
          'oracle_epm_enterprise_profitability_get_job_status',
          'oracle_epm_enterprise_profitability_wait_for_job',
          'oracle_epm_enterprise_profitability_import_data',
          'oracle_epm_enterprise_profitability_export_data',
          'oracle_epm_enterprise_profitability_import_metadata',
          'oracle_epm_enterprise_profitability_export_metadata',
          'oracle_epm_enterprise_profitability_get_job_details',
        ],
      },
    },
    attempts: {
      type: 'number',
      description: 'Status reads performed',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_wait_for_job'],
      },
    },
    offset: {
      type: 'number',
      description: 'Diagnostic offset',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
    },
    limit: {
      type: 'number',
      description: 'Diagnostic page size',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_get_job_details',
          'oracle_epm_enterprise_profitability_get_child_job_details',
        ],
      },
    },
    messages: {
      type: 'array',
      description: 'Child-job diagnostic messages',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_get_child_job_details'],
      },
    },
    grid: {
      type: 'json',
      description: 'Balance/results grid with preserved cell values',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_export_data_slice'],
      },
    },
    numAcceptedCells: {
      type: 'number',
      description: 'Accepted imported cells',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
    },
    numUpdateCells: {
      type: 'number',
      description: 'Updated imported cells when returned',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
    },
    numRejectedCells: {
      type: 'number',
      description: 'Rejected imported cells',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
    },
    rejectedCells: {
      type: 'array',
      description: 'Rejected-cell descriptions when returned (at most 100)',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
    },
    rejectedCellsWithDetails: {
      type: 'array',
      description: 'Rejected-cell reasons when returned',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_import_data_slice'],
      },
    },
    files: {
      type: 'array',
      description: 'Ordinary EXTERNAL repository files',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_list_files'],
      },
    },
    file: {
      type: 'file',
      description: 'Downloaded canonical Sim UserFile',
      condition: {
        field: 'operation',
        value: ['oracle_epm_enterprise_profitability_download_file'],
      },
    },
    fileName: {
      type: 'string',
      description: 'Uploaded/deleted repository filename',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_enterprise_profitability_upload_file',
          'oracle_epm_enterprise_profitability_delete_file',
        ],
      },
    },
  },
}

export const OracleEpcmBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/performance-management/profitability-cost-management/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Validate and calculate allocations',
      prompt:
        'Build a workflow that accepts an existing EPCM application, model, and POV, validates the model, waits for success, calculates allocations, waits again, and exports a selected results grid.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Load profitability input data',
      prompt:
        'Upload a canonical Sim data file without replacing an existing repository file, import it into an EPCM application, wait for completion, and inspect one page of import diagnostics.',
      modules: ['files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Export metadata for review',
      prompt:
        'Run a selected saved EPCM metadata export, wait for success, list ordinary repository files, and download the resulting ZIP into execution storage.',
      modules: ['files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Document an allocation model',
      prompt:
        'Generate a model documentation report for an existing EPCM model in PDF format, wait for completion, and download the named report for review.',
      modules: ['files'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Compare allocation results',
      prompt:
        'Accept two explicit POV grid definitions, export each EPCM results slice sequentially, preserve financial values, and present a comparison of the requested intersections.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Prepare a what-if POV',
      prompt:
        'Copy data from an explicitly supplied source POV to an existing destination POV, wait for success, calculate the destination model, and retrieve selected results.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Create an eligible dynamic member',
      prompt:
        'Inspect a known EPCM parent member, confirm outside the API that dynamic children are enabled and the cube was refreshed, then add the explicitly requested member and inspect the response.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'calculate-epcm-allocations',
      description: 'Validate and execute existing allocation models',
      content:
        '# Validate and execute existing allocation models\n\n## Steps\n\n1. Obtain exact application, model, POV, and delimiter from the user.\n2. Validate the model and wait for success.\n3. Calculate with the requested execution scope and executeCalculations enabled.\n4. Preserve the job ID, wait for success, and export a narrow results grid. Never blindly resubmit an ambiguous calculation.\n\n## Reference\n\nhttps://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/epcm_calculate_model.html',
    },
    {
      name: 'exchange-epcm-data',
      description: 'Import and export bounded data files',
      content:
        '# Import and export bounded data files\n\n## Steps\n\n1. Prefer an existing saved exchange job, or supply every ad hoc data parameter.\n2. Upload ordinary input files without overwrite; then submit the import.\n3. Wait using the returned job ID.\n4. Inspect import/export diagnostics, not calculation traces. Exported output may replace a remote file.\n\n## Reference\n\nhttps://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_data.html',
    },
    {
      name: 'exchange-epcm-metadata',
      description: 'Execute saved metadata jobs',
      content:
        '# Execute saved metadata jobs\n\n## Steps\n\n1. Obtain the exact saved metadata job name; discovery needs EPCM tenant verification.\n2. Match ZIP entries to configured dimensions.\n3. Submit once, wait for completion, inspect parent and child diagnostics.\n4. Download ordinary exported ZIP files after success.\n\n## Reference\n\nhttps://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_metadata.html',
    },
    {
      name: 'inspect-epcm-balances',
      description: 'Read precise result intersections',
      content:
        "# Read precise result intersections\n\n## Steps\n\n1. Ask for the tenant's exact cube and dimension/member selections.\n2. Build explicit POV, row, and column axes, preferably including dimension names.\n3. Export a narrow grid and preserve decimal strings and missing-value markers.\n4. Do not infer balance dimensions or include notes/supporting detail.\n\n## Reference\n\nhttps://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_dataslices.html",
    },
    {
      name: 'manage-epcm-povs',
      description: 'Prepare and clean up explicitly selected POV data',
      content:
        "# Prepare and clean up explicitly selected POV data\n\n## Steps\n\n1. Get explicit source/destination POVs and cubes for copying.\n2. Obtain user authorization before clearing or deleting data.\n3. Select exactly which clear flags are intended.\n4. Submit once and wait; local cancellation does not cancel Oracle's job.\n\n## Reference\n\nhttps://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/epcm_copy_data_by_point_of_view.html",
    },
    {
      name: 'document-epcm-models',
      description: 'Document models and existing calculation rules',
      content:
        '# Document models and existing calculation rules\n\n## Steps\n\n1. Obtain an existing model name and output filename.\n2. Generate model documentation in a supported format.\n3. Wait for the job to complete, then list/download the output.\n4. This report is not a model/rule CRUD API or a rule selector.\n\n## Reference\n\nhttps://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/epcm_generate_model_documentation_report.html',
    },
  ],
} as const satisfies BlockMeta
