import { NetSuiteIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

const OPERATION_INPUT_FIELDS: Record<string, Record<string, string>> = {
  oracle_epm_planning_list_applications: {},
  oracle_epm_planning_list_cubes: {
    application: 'application',
  },
  oracle_epm_planning_list_dimensions: {
    application: 'application',
    cube: 'cube',
    offset: 'offset',
    limit: 'limit',
  },
  oracle_epm_planning_get_dimension: {
    application: 'application',
    cube: 'cube',
    dimension: 'dimension',
    aliasTableName: 'aliasTableName',
  },
  oracle_epm_planning_get_member: {
    application: 'application',
    dimension: 'dimension',
    memberName: 'memberName',
  },
  oracle_epm_planning_add_member: {
    application: 'application',
    dimension: 'dimension',
    memberName: 'memberName',
    parentName: 'parentName',
  },
  oracle_epm_planning_list_substitution_variables: {
    application: 'application',
    cube: 'cube',
    derivedValues: 'derivedValues',
  },
  oracle_epm_planning_get_substitution_variable: {
    application: 'application',
    variableName: 'variableName',
    cube: 'cube',
    derivedValues: 'derivedValues',
  },
  oracle_epm_planning_set_substitution_variables: {
    application: 'application',
    variables: 'variables',
  },
  oracle_epm_planning_delete_substitution_variable: {
    application: 'application',
    variableName: 'variableName',
    cube: 'cube',
  },
  oracle_epm_planning_list_job_definitions: {
    application: 'application',
    jobType: 'jobType',
  },
  oracle_epm_planning_run_job: {
    application: 'application',
    jobType: 'jobType',
    jobName: 'jobName',
    parameters: 'parameters',
  },
  oracle_epm_planning_run_rule: {
    application: 'application',
    jobName: 'ruleName',
    parameters: 'parameters',
  },
  oracle_epm_planning_run_ruleset: {
    application: 'application',
    jobName: 'rulesetName',
    parameters: 'parameters',
  },
  oracle_epm_planning_get_job: {
    application: 'application',
    jobId: 'jobId',
  },
  oracle_epm_planning_wait_for_job: {
    application: 'application',
    jobId: 'jobId',
    maxWaitSeconds: 'maxWaitSeconds',
  },
  oracle_epm_planning_get_job_details: {
    application: 'application',
    jobId: 'jobId',
    offset: 'offset',
    limit: 'limit',
    messageType: 'messageType',
  },
  oracle_epm_planning_export_data_slice: {
    application: 'application',
    cube: 'cube',
    gridDefinition: 'gridDefinition',
  },
  oracle_epm_planning_import_data_slice: {
    application: 'application',
    cube: 'cube',
    dataGrid: 'dataGrid',
    importOptions: 'importOptions',
  },
  oracle_epm_planning_clear_data_slice: {
    application: 'application',
    cube: 'cube',
    gridDefinition: 'gridDefinition',
    clearEssbaseData: 'clearEssbaseData',
    clearPlanningData: 'clearPlanningData',
  },
  oracle_epm_planning_export_form_data: {
    application: 'application',
    form: 'form',
    displayMemberAs: 'displayMemberAs',
    memberAliasDelimiter: 'memberAliasDelimiter',
    forceStartExpanded: 'forceStartExpanded',
  },
  oracle_epm_planning_export_application_data: {
    application: 'application',
    jobName: 'configuredJobName',
    cube: 'cube',
    parameters: 'parameters',
  },
  oracle_epm_planning_import_application_data: {
    application: 'application',
    jobName: 'configuredJobName',
    cube: 'cube',
    fileName: 'fileName',
    parameters: 'parameters',
  },
  oracle_epm_planning_list_files: {},
  oracle_epm_planning_upload_file: {
    file: 'file',
    fileName: 'destinationFileName',
    maxWaitSeconds: 'maxWaitSeconds',
  },
  oracle_epm_planning_download_file: {
    fileName: 'fileName',
    maxWaitSeconds: 'maxWaitSeconds',
  },
  oracle_epm_planning_delete_file: {
    fileName: 'fileName',
  },
  oracle_epm_planning_refresh_cube: {
    application: 'application',
    jobName: 'configuredJobName',
    parameters: 'parameters',
  },
  oracle_epm_planning_set_administration_mode: {
    application: 'application',
    loginLevel: 'loginLevel',
    jobName: 'configuredJobName',
  },
}
const JSON_FIELDS = new Set([
  'variables',
  'parameters',
  'gridDefinition',
  'dataGrid',
  'importOptions',
])
const BOOLEAN_FIELDS = new Set([
  'derivedValues',
  'clearEssbaseData',
  'clearPlanningData',
  'forceStartExpanded',
])

/** Coercion belongs after reference resolution. Inactive fields never leak into another action. */
function operationParams(params: Record<string, unknown>): Record<string, unknown> {
  const fields =
    typeof params.operation === 'string' ? OPERATION_INPUT_FIELDS[params.operation] : undefined
  if (!fields) return {}
  const result: Record<string, unknown> = Object.fromEntries(
    Object.values(OPERATION_INPUT_FIELDS).flatMap((mapping) =>
      Object.keys(mapping).map((field) => [field, undefined])
    )
  )
  result.oauthCredential = params.oauthCredential
  for (const [wire, field] of Object.entries(fields)) {
    const value = params[field]
    if (value === undefined || value === null || value === '') continue
    if (JSON_FIELDS.has(wire)) {
      try {
        result[wire] = typeof value === 'string' ? JSON.parse(value) : value
      } catch {
        throw new Error(`${field} must be valid JSON`)
      }
    } else if (BOOLEAN_FIELDS.has(wire)) {
      if (value !== true && value !== false && value !== 'true' && value !== 'false')
        throw new Error(`${field} must be true or false`)
      result[wire] = value === true || value === 'true'
    } else if (wire === 'offset' || wire === 'limit' || wire === 'maxWaitSeconds') {
      result[wire] = parseOptionalNumberInput(value, field, {
        integer: true,
        min: wire === 'offset' ? 0 : 1,
        max: wire === 'offset' ? 1_000_000 : wire === 'limit' ? 1000 : 3600,
      })
    } else if (wire === 'jobId' && typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Job ID must be a nonnegative safe integer')
      result[wire] = String(value)
    } else if (wire === 'file') {
      result[wire] = normalizeFileInput(value, {
        single: true,
        errorMessage: 'Upload exactly one file',
      })
    } else {
      result[wire] = value
    }
  }
  return result
}

export const OracleEpmPlanningBlock: BlockConfig<OracleEpmPlanningResponse> = {
  type: 'oracle_epm_planning',
  name: 'Oracle EPM Planning & FreeForm',
  description:
    'Manage Planning and FreeForm metadata, variables, rules, jobs, grids, forms and files',
  longDescription:
    'Connect an Oracle EPM service-account credential to Planning and FreeForm. Discover applications, cubes and dimensions; manage dynamic members and substitution variables; run rules and configured jobs; transfer data slices, forms and repository files; and perform explicit cube refresh and login-access changes. Job submission and waiting are separate. Inline results are limited to 16 MiB and downloaded Sim files to 100 MiB. Discovery permissions may be broader than execution permissions: manual names remain available.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_planning',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle EPM Planning & FreeForm',
    sentences: {
      byOperation: {
        oracle_epm_planning_list_applications: ['List available applications'],
        oracle_epm_planning_list_cubes: [
          {
            text: 'List cubes in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_list_dimensions: [
          {
            text: 'List dimensions of',
            field: ['cubeSelector', 'cubeManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_get_dimension: [
          {
            text: 'Read dimension',
            field: ['dimensionSelector', 'dimensionManual'],
            core: true,
          },
          {
            text: 'from cube',
            field: ['cubeSelector', 'cubeManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_get_member: [
          {
            text: 'Read member',
            field: 'memberName',
            core: true,
          },
          {
            text: 'in dimension',
            field: ['dimensionSelector', 'dimensionManual'],
            core: true,
          },
          {
            text: 'of',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_add_member: [
          {
            text: 'Add member',
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
            field: ['dimensionSelector', 'dimensionManual'],
            core: true,
          },
        ],
        oracle_epm_planning_list_substitution_variables: [
          {
            text: 'List substitution variables in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'for cube',
            field: ['cubeSelector', 'cubeManual'],
          },
        ],
        oracle_epm_planning_get_substitution_variable: [
          {
            text: 'Read variable',
            field: 'variableName',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'for cube',
            field: ['cubeSelector', 'cubeManual'],
          },
        ],
        oracle_epm_planning_set_substitution_variables: [
          {
            text: 'Set',
            field: 'variables',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_delete_substitution_variable: [
          {
            text: 'Delete variable',
            field: 'variableName',
            core: true,
          },
          {
            text: 'from',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'for cube',
            field: ['cubeSelector', 'cubeManual'],
          },
        ],
        oracle_epm_planning_list_job_definitions: [
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
        oracle_epm_planning_run_job: [
          {
            text: 'Run job',
            field: ['jobNameSelector', 'jobNameManual'],
            core: true,
          },
          {
            text: 'of type',
            field: 'jobType',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_run_rule: [
          {
            text: 'Run rule',
            field: ['ruleNameSelector', 'ruleNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'with',
            field: 'parameters',
          },
        ],
        oracle_epm_planning_run_ruleset: [
          {
            text: 'Run ruleset',
            field: ['rulesetNameSelector', 'rulesetNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'with',
            field: 'parameters',
          },
        ],
        oracle_epm_planning_get_job: [
          {
            text: 'Read job',
            field: 'jobId',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_wait_for_job: [
          {
            text: 'Wait for job',
            field: 'jobId',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_get_job_details: [
          {
            text: 'Read diagnostics for job',
            field: 'jobId',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'filtered by',
            field: 'messageType',
          },
        ],
        oracle_epm_planning_export_data_slice: [
          {
            text: 'Export',
            field: 'gridDefinition',
            core: true,
          },
          {
            text: 'from cube',
            field: ['cubeSelector', 'cubeManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_import_data_slice: [
          {
            text: 'Import',
            field: 'dataGrid',
            core: true,
          },
          {
            text: 'into cube',
            field: ['cubeSelector', 'cubeManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_clear_data_slice: [
          {
            text: 'Clear',
            field: 'gridDefinition',
            core: true,
          },
          {
            text: 'from cube',
            field: ['cubeSelector', 'cubeManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_export_form_data: [
          {
            text: 'Export form',
            field: 'form',
            core: true,
          },
          {
            text: 'from',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_export_application_data: [
          {
            text: 'Export data from',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'using job',
            field: 'configuredJobName',
          },
          {
            text: 'with',
            field: 'parameters',
          },
        ],
        oracle_epm_planning_import_application_data: [
          {
            text: 'Import data into',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
          {
            text: 'using job',
            field: 'configuredJobName',
          },
          {
            text: 'from',
            field: ['fileNameSelector', 'fileNameManual'],
          },
        ],
        oracle_epm_planning_list_files: ['List repository files'],
        oracle_epm_planning_upload_file: [
          {
            text: 'Upload',
            field: ['uploadFile', 'fileReference'],
            core: true,
          },
          {
            text: 'as',
            field: 'destinationFileName',
          },
        ],
        oracle_epm_planning_download_file: [
          {
            text: 'Download repository file',
            field: ['fileNameSelector', 'fileNameManual'],
            core: true,
          },
        ],
        oracle_epm_planning_delete_file: [
          {
            text: 'Permanently delete repository file',
            field: ['fileNameSelector', 'fileNameManual'],
            core: true,
          },
        ],
        oracle_epm_planning_refresh_cube: [
          {
            text: 'Refresh cubes with job',
            field: 'configuredJobName',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_set_administration_mode: [
          {
            text: 'Set application access to',
            field: 'loginLevel',
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
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
      serviceId: 'oracle-epm',
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
        { label: 'List Applications', id: 'oracle_epm_planning_list_applications' },
        { label: 'List Cubes', id: 'oracle_epm_planning_list_cubes' },
        { label: 'List Dimensions', id: 'oracle_epm_planning_list_dimensions' },
        { label: 'Get Dimension', id: 'oracle_epm_planning_get_dimension' },
        { label: 'Get Member', id: 'oracle_epm_planning_get_member' },
        { label: 'Add Member', id: 'oracle_epm_planning_add_member' },
        {
          label: 'List Substitution Variables',
          id: 'oracle_epm_planning_list_substitution_variables',
        },
        { label: 'Get Substitution Variable', id: 'oracle_epm_planning_get_substitution_variable' },
        {
          label: 'Set Substitution Variables',
          id: 'oracle_epm_planning_set_substitution_variables',
        },
        {
          label: 'Delete Substitution Variable',
          id: 'oracle_epm_planning_delete_substitution_variable',
        },
        { label: 'List Job Definitions', id: 'oracle_epm_planning_list_job_definitions' },
        { label: 'Run Job', id: 'oracle_epm_planning_run_job' },
        { label: 'Run Rule', id: 'oracle_epm_planning_run_rule' },
        { label: 'Run Ruleset', id: 'oracle_epm_planning_run_ruleset' },
        { label: 'Get Job', id: 'oracle_epm_planning_get_job' },
        { label: 'Wait For Job', id: 'oracle_epm_planning_wait_for_job' },
        { label: 'Get Job Details', id: 'oracle_epm_planning_get_job_details' },
        { label: 'Export Data Slice', id: 'oracle_epm_planning_export_data_slice' },
        { label: 'Import Data Slice', id: 'oracle_epm_planning_import_data_slice' },
        { label: 'Clear Data Slice', id: 'oracle_epm_planning_clear_data_slice' },
        { label: 'Export Form Data', id: 'oracle_epm_planning_export_form_data' },
        { label: 'Export Application Data', id: 'oracle_epm_planning_export_application_data' },
        { label: 'Import Application Data', id: 'oracle_epm_planning_import_application_data' },
        { label: 'List Files', id: 'oracle_epm_planning_list_files' },
        { label: 'Upload File', id: 'oracle_epm_planning_upload_file' },
        { label: 'Download File', id: 'oracle_epm_planning_download_file' },
        { label: 'Delete File', id: 'oracle_epm_planning_delete_file' },
        { label: 'Refresh Cube', id: 'oracle_epm_planning_refresh_cube' },
        { label: 'Set Administration Mode', id: 'oracle_epm_planning_set_administration_mode' },
      ],
      value: () => 'oracle_epm_planning_list_applications',
      required: true,
    },
    {
      id: 'applicationSelector',
      title: 'Application',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_cubes',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
          'oracle_epm_planning_list_substitution_variables',
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_set_substitution_variables',
          'oracle_epm_planning_delete_substitution_variable',
          'oracle_epm_planning_list_job_definitions',
          'oracle_epm_planning_run_job',
          'oracle_epm_planning_run_rule',
          'oracle_epm_planning_run_ruleset',
          'oracle_epm_planning_get_job',
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_get_job_details',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
          'oracle_epm_planning_export_form_data',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_refresh_cube',
          'oracle_epm_planning_set_administration_mode',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_cubes',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
          'oracle_epm_planning_list_substitution_variables',
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_set_substitution_variables',
          'oracle_epm_planning_delete_substitution_variable',
          'oracle_epm_planning_list_job_definitions',
          'oracle_epm_planning_run_job',
          'oracle_epm_planning_run_rule',
          'oracle_epm_planning_run_ruleset',
          'oracle_epm_planning_get_job',
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_get_job_details',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
          'oracle_epm_planning_export_form_data',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_refresh_cube',
          'oracle_epm_planning_set_administration_mode',
        ],
      },
      type: 'project-selector',
      canonicalParamId: 'application',
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.applications',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select application',
    },
    {
      id: 'applicationManual',
      title: 'Application',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_cubes',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
          'oracle_epm_planning_list_substitution_variables',
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_set_substitution_variables',
          'oracle_epm_planning_delete_substitution_variable',
          'oracle_epm_planning_list_job_definitions',
          'oracle_epm_planning_run_job',
          'oracle_epm_planning_run_rule',
          'oracle_epm_planning_run_ruleset',
          'oracle_epm_planning_get_job',
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_get_job_details',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
          'oracle_epm_planning_export_form_data',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_refresh_cube',
          'oracle_epm_planning_set_administration_mode',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_cubes',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
          'oracle_epm_planning_list_substitution_variables',
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_set_substitution_variables',
          'oracle_epm_planning_delete_substitution_variable',
          'oracle_epm_planning_list_job_definitions',
          'oracle_epm_planning_run_job',
          'oracle_epm_planning_run_rule',
          'oracle_epm_planning_run_ruleset',
          'oracle_epm_planning_get_job',
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_get_job_details',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
          'oracle_epm_planning_export_form_data',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_refresh_cube',
          'oracle_epm_planning_set_administration_mode',
        ],
      },
      type: 'short-input',
      canonicalParamId: 'application',
      mode: 'advanced',
      placeholder: 'Enter application manually',
    },
    {
      id: 'cubeSelector',
      title: 'Cube',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_list_substitution_variables',
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_delete_substitution_variable',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
        ],
      },
      type: 'project-selector',
      canonicalParamId: 'cube',
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.cubes',
      dependsOn: ['credential', 'applicationSelector'],
      mode: 'basic',
      placeholder: 'Select cube',
    },
    {
      id: 'cubeManual',
      title: 'Cube',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_list_substitution_variables',
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_delete_substitution_variable',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
        ],
      },
      type: 'short-input',
      canonicalParamId: 'cube',
      mode: 'advanced',
      placeholder: 'Enter cube manually',
    },
    {
      id: 'offset',
      mode: 'advanced',
      title: 'Offset',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_list_dimensions', 'oracle_epm_planning_get_job_details'],
      },
      required: false,
      type: 'short-input',
      placeholder: 'Zero-based page offset (default 0).',
    },
    {
      id: 'limit',
      mode: 'advanced',
      title: 'Limit',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_list_dimensions', 'oracle_epm_planning_get_job_details'],
      },
      required: false,
      type: 'short-input',
      placeholder: 'Page size, 1–1000 (default 100).',
    },
    {
      id: 'dimensionSelector',
      title: 'Dimension',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
        ],
      },
      type: 'project-selector',
      canonicalParamId: 'dimension',
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.dimensions',
      dependsOn: ['credential', 'applicationSelector', 'cubeSelector'],
      mode: 'basic',
      placeholder: 'Select dimension',
    },
    {
      id: 'dimensionManual',
      title: 'Dimension',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_get_member',
          'oracle_epm_planning_add_member',
        ],
      },
      type: 'short-input',
      canonicalParamId: 'dimension',
      mode: 'advanced',
      placeholder: 'Enter dimension manually',
    },
    {
      id: 'aliasTableName',
      mode: 'advanced',
      title: 'Alias Table',
      condition: { field: 'operation', value: ['oracle_epm_planning_get_dimension'] },
      required: false,
      type: 'short-input',
      placeholder: 'Optional alias table name for the dimension hierarchy.',
    },
    {
      id: 'memberName',
      title: 'Member Name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_member', 'oracle_epm_planning_add_member'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_get_member', 'oracle_epm_planning_add_member'],
      },
      type: 'short-input',
      placeholder: 'Exact member name.',
    },
    {
      id: 'parentName',
      title: 'Parent Name',
      condition: { field: 'operation', value: ['oracle_epm_planning_add_member'] },
      required: { field: 'operation', value: ['oracle_epm_planning_add_member'] },
      type: 'short-input',
      placeholder: 'Dynamic-enabled parent member name.',
    },
    {
      id: 'derivedValues',
      mode: 'advanced',
      title: 'Derived Values',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_list_substitution_variables',
          'oracle_epm_planning_get_substitution_variable',
        ],
      },
      required: false,
      type: 'switch',
      placeholder: 'Include inherited application variables for a cube (default false).',
      defaultValue: false,
    },
    {
      id: 'variableName',
      title: 'Variable Name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_delete_substitution_variable',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_substitution_variable',
          'oracle_epm_planning_delete_substitution_variable',
        ],
      },
      type: 'short-input',
      placeholder: 'Substitution variable name.',
    },
    {
      id: 'variables',
      canvasNoun: 'variables',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Oracle EPM Planning variables using only the fields requested by the user and documented by Oracle. Variables to create or update: [{name, value, planType}]. Use ALL for application scope. Do not invent member names, runtime prompt names or unsupported fields. Return ONLY the JSON array.',
        placeholder: 'Describe the Planning variables',
      },
      title: 'Substitution Variables (JSON)',
      condition: { field: 'operation', value: ['oracle_epm_planning_set_substitution_variables'] },
      required: { field: 'operation', value: ['oracle_epm_planning_set_substitution_variables'] },
      type: 'code',
      placeholder:
        'Variables to create or update: [{name, value, planType}]. Use ALL for application scope.',
      language: 'json',
    },
    {
      id: 'jobType',
      title: 'Job Type',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_list_job_definitions', 'oracle_epm_planning_run_job'],
      },
      required: { field: 'operation', value: ['oracle_epm_planning_run_job'] },
      type: 'short-input',
      placeholder: 'Oracle job type, such as RULES, RULESET, IMPORT_DATA or EXPORT_DATA.',
    },
    {
      id: 'jobNameSelector',
      title: 'Job Name',
      condition: { field: 'operation', value: ['oracle_epm_planning_run_job'] },
      required: { field: 'operation', value: ['oracle_epm_planning_run_job'] },
      type: 'project-selector',
      canonicalParamId: 'jobName',
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.jobDefinitions',
      dependsOn: ['credential', 'applicationSelector', 'jobType'],
      mode: 'basic',
      placeholder: 'Select job name',
    },
    {
      id: 'jobNameManual',
      title: 'Job Name',
      condition: { field: 'operation', value: ['oracle_epm_planning_run_job'] },
      required: { field: 'operation', value: ['oracle_epm_planning_run_job'] },
      type: 'short-input',
      canonicalParamId: 'jobName',
      mode: 'advanced',
      placeholder: 'Enter job name manually',
    },
    {
      id: 'parameters',
      canvasNoun: 'parameters',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Oracle EPM Planning parameters using only the fields requested by the user and documented by Oracle. Job-specific parameters or runtime prompts as a JSON object. Parameter names must match Oracle or the deployed job. Do not invent member names, runtime prompt names or unsupported fields. Return ONLY the JSON object.',
        placeholder: 'Describe the Planning parameters',
      },
      title: 'Job Parameters / Runtime Prompts (JSON)',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_run_job',
          'oracle_epm_planning_run_rule',
          'oracle_epm_planning_run_ruleset',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_refresh_cube',
        ],
      },
      required: false,
      type: 'code',
      placeholder:
        'Job-specific parameters or runtime prompts as a JSON object. Parameter names must match Oracle or the deployed job.',
      language: 'json',
    },
    {
      id: 'ruleNameSelector',
      title: 'Business Rule',
      condition: { field: 'operation', value: ['oracle_epm_planning_run_rule'] },
      required: { field: 'operation', value: ['oracle_epm_planning_run_rule'] },
      type: 'project-selector',
      canonicalParamId: 'ruleName',
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.rules',
      dependsOn: ['credential', 'applicationSelector'],
      mode: 'basic',
      placeholder: 'Select business rule',
    },
    {
      id: 'ruleNameManual',
      title: 'Business Rule',
      condition: { field: 'operation', value: ['oracle_epm_planning_run_rule'] },
      required: { field: 'operation', value: ['oracle_epm_planning_run_rule'] },
      type: 'short-input',
      canonicalParamId: 'ruleName',
      mode: 'advanced',
      placeholder: 'Enter business rule manually',
    },
    {
      id: 'rulesetNameSelector',
      title: 'Ruleset',
      condition: { field: 'operation', value: ['oracle_epm_planning_run_ruleset'] },
      required: { field: 'operation', value: ['oracle_epm_planning_run_ruleset'] },
      type: 'project-selector',
      canonicalParamId: 'rulesetName',
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.rulesets',
      dependsOn: ['credential', 'applicationSelector'],
      mode: 'basic',
      placeholder: 'Select ruleset',
    },
    {
      id: 'rulesetNameManual',
      title: 'Ruleset',
      condition: { field: 'operation', value: ['oracle_epm_planning_run_ruleset'] },
      required: { field: 'operation', value: ['oracle_epm_planning_run_ruleset'] },
      type: 'short-input',
      canonicalParamId: 'rulesetName',
      mode: 'advanced',
      placeholder: 'Enter ruleset manually',
    },
    {
      id: 'jobId',
      title: 'Job ID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_job',
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_get_job_details',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_job',
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_get_job_details',
        ],
      },
      type: 'short-input',
      placeholder: 'Numeric ID returned when the Planning job was submitted.',
    },
    {
      id: 'maxWaitSeconds',
      mode: 'advanced',
      title: 'Max Wait Seconds',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_upload_file',
          'oracle_epm_planning_download_file',
        ],
      },
      required: false,
      type: 'short-input',
      placeholder:
        'Maximum wait in seconds (1–3600, default 300); also bounded by the workflow deadline.',
    },
    {
      id: 'messageType',
      mode: 'advanced',
      title: 'Message Type',
      condition: { field: 'operation', value: ['oracle_epm_planning_get_job_details'] },
      required: false,
      type: 'dropdown',
      placeholder: 'Diagnostic message filter: INFO, WARNING or ERROR.',
      options: [
        { label: 'INFO', id: 'INFO' },
        { label: 'WARNING', id: 'WARNING' },
        { label: 'ERROR', id: 'ERROR' },
      ],
    },
    {
      id: 'gridDefinition',
      canvasNoun: 'grid',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Oracle EPM Planning gridDefinition using only the fields requested by the user and documented by Oracle. Grid selection: pov {members: string[][]}, columns and rows arrays of {members: string[][]}; optional dimensions and missing-cell suppression flags. Do not invent member names, runtime prompt names or unsupported fields. Return ONLY the JSON object.',
        placeholder: 'Describe the Planning gridDefinition',
      },
      title: 'Grid Definition (JSON)',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_export_data_slice', 'oracle_epm_planning_clear_data_slice'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_export_data_slice', 'oracle_epm_planning_clear_data_slice'],
      },
      type: 'code',
      placeholder:
        'Grid selection: pov {members: string[][]}, columns and rows arrays of {members: string[][]}; optional dimensions and missing-cell suppression flags.',
      language: 'json',
    },
    {
      id: 'dataGrid',
      canvasNoun: 'grid',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Oracle EPM Planning dataGrid using only the fields requested by the user and documented by Oracle. Cell grid: pov string[], columns string[][], rows [{headers: string[], data: (string|number)[]}]. Use #missing to clear a cell. Do not invent member names, runtime prompt names or unsupported fields. Return ONLY the JSON object.',
        placeholder: 'Describe the Planning dataGrid',
      },
      title: 'Data Grid (JSON)',
      condition: { field: 'operation', value: ['oracle_epm_planning_import_data_slice'] },
      required: { field: 'operation', value: ['oracle_epm_planning_import_data_slice'] },
      type: 'code',
      placeholder:
        'Cell grid: pov string[], columns string[][], rows [{headers: string[], data: (string|number)[]}]. Use #missing to clear a cell.',
      language: 'json',
    },
    {
      id: 'importOptions',
      mode: 'advanced',
      canvasNoun: 'import options',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Oracle EPM Planning importOptions using only the fields requested by the user and documented by Oracle. Optional aggregateEssbaseData, cellNotesOption (Overwrite/Append/Skip), dateFormat, strictDateValidation. Defaults follow Oracle. Do not invent member names, runtime prompt names or unsupported fields. Return ONLY the JSON object.',
        placeholder: 'Describe the Planning importOptions',
      },
      title: 'Import Options (JSON)',
      condition: { field: 'operation', value: ['oracle_epm_planning_import_data_slice'] },
      required: false,
      type: 'code',
      placeholder:
        'Optional aggregateEssbaseData, cellNotesOption (Overwrite/Append/Skip), dateFormat, strictDateValidation. Defaults follow Oracle.',
      language: 'json',
    },
    {
      id: 'clearEssbaseData',
      title: 'Clear Essbase Data',
      condition: { field: 'operation', value: ['oracle_epm_planning_clear_data_slice'] },
      required: false,
      type: 'switch',
      placeholder: 'Clear Essbase cell values (default true). This is destructive.',
      defaultValue: true,
    },
    {
      id: 'clearPlanningData',
      title: 'Clear Planning Data',
      condition: { field: 'operation', value: ['oracle_epm_planning_clear_data_slice'] },
      required: false,
      type: 'switch',
      placeholder: 'Clear Planning cell details (default false). This is destructive.',
      defaultValue: false,
    },
    {
      id: 'form',
      title: 'Form',
      condition: { field: 'operation', value: ['oracle_epm_planning_export_form_data'] },
      required: { field: 'operation', value: ['oracle_epm_planning_export_form_data'] },
      type: 'short-input',
      placeholder: 'Exact form name or ID. Form discovery and page filtering are not supported.',
    },
    {
      id: 'displayMemberAs',
      mode: 'advanced',
      title: 'Display Member As',
      condition: { field: 'operation', value: ['oracle_epm_planning_export_form_data'] },
      required: false,
      type: 'dropdown',
      placeholder:
        'MEMBER_NAME, MEMBER_NAME_THEN_ALIAS, or ALIAS_THEN_MEMBER_NAME (default MEMBER_NAME).',
      options: [
        { label: 'MEMBER_NAME', id: 'MEMBER_NAME' },
        { label: 'MEMBER_NAME_THEN_ALIAS', id: 'MEMBER_NAME_THEN_ALIAS' },
        { label: 'ALIAS_THEN_MEMBER_NAME', id: 'ALIAS_THEN_MEMBER_NAME' },
      ],
    },
    {
      id: 'memberAliasDelimiter',
      mode: 'advanced',
      title: 'Member Alias Delimiter',
      condition: { field: 'operation', value: ['oracle_epm_planning_export_form_data'] },
      required: false,
      type: 'short-input',
      placeholder: 'Delimiter between a member and alias (default colon).',
    },
    {
      id: 'forceStartExpanded',
      mode: 'advanced',
      title: 'Force Start Expanded',
      condition: { field: 'operation', value: ['oracle_epm_planning_export_form_data'] },
      required: false,
      type: 'switch',
      placeholder: 'Force expandable form rows and columns to start expanded (default false).',
      defaultValue: false,
    },
    {
      id: 'configuredJobName',
      title: 'Configured Job Name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_refresh_cube',
          'oracle_epm_planning_set_administration_mode',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_planning_refresh_cube'] },
      type: 'short-input',
      placeholder: 'Configured job, deployed rule or ruleset name.',
    },
    {
      id: 'fileNameSelector',
      title: 'File Name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_download_file',
          'oracle_epm_planning_delete_file',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_download_file', 'oracle_epm_planning_delete_file'],
      },
      type: 'project-selector',
      canonicalParamId: 'fileName',
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.files',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select file name',
    },
    {
      id: 'fileNameManual',
      title: 'File Name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_download_file',
          'oracle_epm_planning_delete_file',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_download_file', 'oracle_epm_planning_delete_file'],
      },
      type: 'short-input',
      canonicalParamId: 'fileName',
      mode: 'advanced',
      placeholder: 'Enter file name manually',
    },
    {
      id: 'uploadFile',
      title: 'File to Upload',
      condition: { field: 'operation', value: ['oracle_epm_planning_upload_file'] },
      required: { field: 'operation', value: ['oracle_epm_planning_upload_file'] },
      type: 'file-upload',
      canonicalParamId: 'file',
      multiple: false,
      mode: 'basic',
      maxSize: 5368709120,
      canvasNoun: 'file',
      placeholder: 'Select one Sim file',
    },
    {
      id: 'fileReference',
      title: 'File Reference',
      condition: { field: 'operation', value: ['oracle_epm_planning_upload_file'] },
      required: { field: 'operation', value: ['oracle_epm_planning_upload_file'] },
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      placeholder: 'Reference a UserFile from a previous block',
    },
    {
      id: 'destinationFileName',
      title: 'Destination File Name',
      condition: { field: 'operation', value: ['oracle_epm_planning_upload_file'] },
      required: false,
      type: 'short-input',
      placeholder:
        'Oracle repository file name, including any documented repository folder. Download outputs are limited to 100 MiB.',
    },
    {
      id: 'loginLevel',
      title: 'Login Access',
      condition: { field: 'operation', value: ['oracle_epm_planning_set_administration_mode'] },
      required: { field: 'operation', value: ['oracle_epm_planning_set_administration_mode'] },
      type: 'dropdown',
      placeholder:
        'Administrators or All Users. Administrators mode logs off Interactive Users and Planners.',
      options: [
        { label: 'Administrators', id: 'Administrators' },
        { label: 'All Users', id: 'All Users' },
      ],
    },
  ],
  tools: {
    access: [
      'oracle_epm_planning_list_applications',
      'oracle_epm_planning_list_cubes',
      'oracle_epm_planning_list_dimensions',
      'oracle_epm_planning_get_dimension',
      'oracle_epm_planning_get_member',
      'oracle_epm_planning_add_member',
      'oracle_epm_planning_list_substitution_variables',
      'oracle_epm_planning_get_substitution_variable',
      'oracle_epm_planning_set_substitution_variables',
      'oracle_epm_planning_delete_substitution_variable',
      'oracle_epm_planning_list_job_definitions',
      'oracle_epm_planning_run_job',
      'oracle_epm_planning_run_rule',
      'oracle_epm_planning_run_ruleset',
      'oracle_epm_planning_get_job',
      'oracle_epm_planning_wait_for_job',
      'oracle_epm_planning_get_job_details',
      'oracle_epm_planning_export_data_slice',
      'oracle_epm_planning_import_data_slice',
      'oracle_epm_planning_clear_data_slice',
      'oracle_epm_planning_export_form_data',
      'oracle_epm_planning_export_application_data',
      'oracle_epm_planning_import_application_data',
      'oracle_epm_planning_list_files',
      'oracle_epm_planning_upload_file',
      'oracle_epm_planning_download_file',
      'oracle_epm_planning_delete_file',
      'oracle_epm_planning_refresh_cube',
      'oracle_epm_planning_set_administration_mode',
    ],
    config: { tool: (params) => params.operation, params: operationParams },
  },
  inputs: {
    operation: { type: 'string', description: 'Planning operation' },
    oauthCredential: { type: 'string', description: 'Oracle EPM service-account credential' },
    application: {
      type: 'string',
      description: 'Application name, exactly as configured in Oracle.',
    },
    cube: { type: 'string', description: 'Cube / plan type name, not its numeric plan type ID.' },
    offset: { type: 'number', description: 'Zero-based page offset (default 0).' },
    limit: { type: 'number', description: 'Page size, 1–1000 (default 100).' },
    dimension: { type: 'string', description: 'Dimension name.' },
    aliasTableName: {
      type: 'string',
      description: 'Optional alias table name for the dimension hierarchy.',
    },
    memberName: { type: 'string', description: 'Exact member name.' },
    parentName: { type: 'string', description: 'Dynamic-enabled parent member name.' },
    derivedValues: {
      type: 'boolean',
      description: 'Include inherited application variables for a cube (default false).',
    },
    variableName: { type: 'string', description: 'Substitution variable name.' },
    variables: {
      type: 'array',
      description:
        'Variables to create or update: [{name, value, planType}]. Use ALL for application scope.',
    },
    jobType: {
      type: 'string',
      description: 'Oracle job type, such as RULES, RULESET, IMPORT_DATA or EXPORT_DATA.',
    },
    jobName: { type: 'string', description: 'Configured job, deployed rule or ruleset name.' },
    parameters: {
      type: 'json',
      description:
        'Job-specific parameters or runtime prompts as a JSON object. Parameter names must match Oracle or the deployed job.',
    },
    ruleName: { type: 'string', description: 'Configured job, deployed rule or ruleset name.' },
    rulesetName: { type: 'string', description: 'Configured job, deployed rule or ruleset name.' },
    jobId: {
      type: 'string',
      description: 'Numeric ID returned when the Planning job was submitted.',
    },
    maxWaitSeconds: {
      type: 'number',
      description:
        'Maximum wait in seconds (1–3600, default 300); also bounded by the workflow deadline.',
    },
    messageType: {
      type: 'string',
      description: 'Diagnostic message filter: INFO, WARNING or ERROR.',
    },
    gridDefinition: {
      type: 'json',
      description:
        'Grid selection: pov {members: string[][]}, columns and rows arrays of {members: string[][]}; optional dimensions and missing-cell suppression flags.',
    },
    dataGrid: {
      type: 'json',
      description:
        'Cell grid: pov string[], columns string[][], rows [{headers: string[], data: (string|number)[]}]. Use #missing to clear a cell.',
    },
    importOptions: {
      type: 'json',
      description:
        'Optional aggregateEssbaseData, cellNotesOption (Overwrite/Append/Skip), dateFormat, strictDateValidation. Defaults follow Oracle.',
    },
    clearEssbaseData: {
      type: 'boolean',
      description: 'Clear Essbase cell values (default true). This is destructive.',
    },
    clearPlanningData: {
      type: 'boolean',
      description: 'Clear Planning cell details (default false). This is destructive.',
    },
    form: {
      type: 'string',
      description: 'Exact form name or ID. Form discovery and page filtering are not supported.',
    },
    displayMemberAs: {
      type: 'string',
      description:
        'MEMBER_NAME, MEMBER_NAME_THEN_ALIAS, or ALIAS_THEN_MEMBER_NAME (default MEMBER_NAME).',
    },
    memberAliasDelimiter: {
      type: 'string',
      description: 'Delimiter between a member and alias (default colon).',
    },
    forceStartExpanded: {
      type: 'boolean',
      description: 'Force expandable form rows and columns to start expanded (default false).',
    },
    configuredJobName: {
      type: 'string',
      description: 'Configured job, deployed rule or ruleset name.',
    },
    fileName: {
      type: 'string',
      description:
        'Oracle repository file name, including any documented repository folder. Download outputs are limited to 100 MiB.',
    },
    file: {
      type: 'file',
      description:
        'One authorized Sim UserFile. Maximum Sim input size: 5 GiB; Oracle may impose additional limits.',
    },
    destinationFileName: {
      type: 'string',
      description:
        'Oracle repository file name, including any documented repository folder. Download outputs are limited to 100 MiB.',
    },
    loginLevel: {
      type: 'string',
      description:
        'Administrators or All Users. Administrators mode logs off Interactive Users and Planners.',
    },
  },
  outputs: {
    applications: {
      type: 'array',
      description: 'Available applications',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_applications'] },
    },
    cubes: {
      type: 'array',
      description: 'Application cubes',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_cubes'] },
    },
    dimensions: {
      type: 'array',
      description: 'One page of dimension summaries',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_dimensions'] },
    },
    totalResults: {
      type: 'number',
      description: 'Total dimensions',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_dimensions'] },
    },
    hasMore: {
      type: 'boolean',
      description: 'More dimension pages are available',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_dimensions'] },
    },
    dimension: {
      type: 'json',
      description: 'Dimension hierarchy',
      condition: { field: 'operation', value: ['oracle_epm_planning_get_dimension'] },
    },
    member: {
      type: 'json',
      description: 'Member metadata',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_member', 'oracle_epm_planning_add_member'],
      },
    },
    variables: {
      type: 'array',
      description: 'Substitution variables',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_substitution_variables'] },
    },
    variable: {
      type: 'json',
      description: 'Substitution variable',
      condition: { field: 'operation', value: ['oracle_epm_planning_get_substitution_variable'] },
    },
    updated: {
      type: 'boolean',
      description: 'All supplied variables were accepted',
      condition: { field: 'operation', value: ['oracle_epm_planning_set_substitution_variables'] },
    },
    deleted: {
      type: 'boolean',
      description: 'Deletion completed',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_delete_substitution_variable',
          'oracle_epm_planning_delete_file',
        ],
      },
    },
    jobDefinitions: {
      type: 'array',
      description: 'Configured jobs',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_job_definitions'] },
    },
    job: {
      type: 'json',
      description: 'Planning job snapshot',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_run_job',
          'oracle_epm_planning_run_rule',
          'oracle_epm_planning_run_ruleset',
          'oracle_epm_planning_get_job',
          'oracle_epm_planning_wait_for_job',
          'oracle_epm_planning_export_application_data',
          'oracle_epm_planning_import_application_data',
          'oracle_epm_planning_refresh_cube',
          'oracle_epm_planning_set_administration_mode',
        ],
      },
    },
    jobDetails: {
      type: 'array',
      description: 'One page of import/export diagnostics',
      condition: { field: 'operation', value: ['oracle_epm_planning_get_job_details'] },
    },
    dataGrid: {
      type: 'json',
      description: 'Exported cell grid',
      condition: { field: 'operation', value: ['oracle_epm_planning_export_data_slice'] },
    },
    importResult: {
      type: 'json',
      description: 'Import counts and rejection diagnostics',
      condition: { field: 'operation', value: ['oracle_epm_planning_import_data_slice'] },
    },
    clearResult: {
      type: 'json',
      description: 'Clear counts and rejection diagnostics',
      condition: { field: 'operation', value: ['oracle_epm_planning_clear_data_slice'] },
    },
    formData: {
      type: 'json',
      description: 'Form-specific numeric export',
      condition: { field: 'operation', value: ['oracle_epm_planning_export_form_data'] },
    },
    files: {
      type: 'array',
      description: 'Repository files and snapshots',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_files'] },
    },
    upload: {
      type: 'json',
      description: 'Completed upload',
      condition: { field: 'operation', value: ['oracle_epm_planning_upload_file'] },
    },
    file: {
      type: 'file',
      description: 'Stored Sim UserFile (at most 100 MiB)',
      condition: { field: 'operation', value: ['oracle_epm_planning_download_file'] },
    },
  },
}
export const OracleEpmPlanningBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/performance-management/planning/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Run a Planning rule and monitor it',
      prompt:
        'Build a workflow that runs a deployed Planning business rule with supplied runtime prompts, saves job.jobId, uses Wait for Job with an explicit timeout, and reports the final job status.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Export Planning data to the repository',
      prompt:
        'Build a scheduled workflow that submits a configured Export Application Data job, waits for completion, lists repository files, and downloads the chosen ZIP only if it fits the 100 MiB Sim output limit. Keep larger exports in Oracle.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Import a file and report rejections',
      prompt:
        'Build a workflow that uploads one authorized Sim file, runs a configured Import Application Data job using its repository name, waits for completion, and reads job details to report rejected records and the configured error file.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Update a planning period variable',
      prompt:
        'Build a workflow that reads an application substitution variable, records its previous value, updates only the requested variable with planType ALL, then reads it again to confirm the new planning period.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Compare forecast data slices',
      prompt:
        'Build a scheduled workflow that exports two explicitly configured forecast data slices, compares their numeric cells, and writes the differences to a table. Keep each inline result within 16 MiB.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Export a Planning form for review',
      prompt:
        'Create a workflow that exports a manually specified Planning form by name, reads the form-specific dimension layout and numeric rows, and prepares a review table without assuming data-slice POV structure.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Refresh approved metadata changes',
      prompt:
        'Build a workflow that requires approval before adding a member under an already dynamic-enabled parent, submits an existing Cube Refresh job, waits for completion, and reports any failure. Do not change administration mode implicitly.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Stage a controlled maintenance window',
      prompt:
        'Build a manually started workflow that changes application login access to Administrators only after explicit approval, waits for that job, runs a configured refresh job, and restores All Users access in a separately visible approved step.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
  ],
  skills: [
    {
      name: 'discover-planning-metadata',
      description: 'Discover application metadata with manual fallback',
      content:
        '# Discover application metadata with manual fallback\n\n## Steps\n\n1. List Applications using an administrator credential.\n2. List Cubes and use planTypeName, not a numeric ID.\n3. Page List Dimensions until hasMore is false, or Get Dimension for a bounded hierarchy.\n4. If discovery permission is unavailable, use exact manual application, cube and dimension names.\n\n## Output\n\nReturn the documented outputs, identifiers and important limits. Report partial failures explicitly.',
    },
    {
      name: 'run-planning-jobs',
      description: 'Submit and monitor Planning jobs',
      content:
        '# Submit and monitor Planning jobs\n\n## Steps\n\n1. Select a configured job or deployed rule/ruleset.\n2. Supply its documented parameters or string runtime prompts.\n3. Submit once and retain job.jobId.\n4. Use Wait for Job; a submission is not completion. Never automatically replay a failed mutation.\n5. Inspect returned job details and import/export diagnostics.\n\n## Output\n\nReturn the documented outputs, identifiers and important limits. Report partial failures explicitly.',
    },
    {
      name: 'exchange-planning-files',
      description: 'Transfer Planning repository files within Sim limits',
      content:
        '# Transfer Planning repository files within Sim limits\n\n## Steps\n\n1. Upload one authorized UserFile, not an arbitrary URL.\n2. Use a new repository file name; uploads never delete conflicting files.\n3. Submit and wait for the import/export job.\n4. Download only outputs at most 100 MiB; keep larger files in Oracle.\n5. Preserve rejection/error-file identifiers and report failures separately.\n\n## Output\n\nReturn the documented outputs, identifiers and important limits. Report partial failures explicitly.',
    },
    {
      name: 'work-with-planning-grids',
      description: 'Read and write bounded Planning grids',
      content:
        '# Read and write bounded Planning grids\n\n## Steps\n\n1. Define POV, row and column members explicitly.\n2. Export Data Slice with the desired missing-cell suppression.\n3. Validate headers before Import Data Slice.\n4. Check numRejectedCells and rejection reasons, even after HTTP success.\n5. Clear Data Slice only after explicit destructive-action approval.\n\n## Output\n\nReturn the documented outputs, identifiers and important limits. Report partial failures explicitly.',
    },
    {
      name: 'maintain-planning-applications',
      description: 'Apply explicit Planning administration changes',
      content:
        '# Apply explicit Planning administration changes\n\n## Steps\n\n1. Use a parent already configured for dynamic children before Add Member.\n2. Run a preconfigured Cube Refresh job only when requested.\n3. Administration Mode Administrators logs off Interactive Users and Planners.\n4. Keep access changes explicit and restore All Users only when authorized.\n\n## Output\n\nReturn the documented outputs, identifiers and important limits. Report partial failures explicitly.',
    },
  ],
} as const satisfies BlockMeta
