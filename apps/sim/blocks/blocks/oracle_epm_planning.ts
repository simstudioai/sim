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
  oracle_epm_planning_run_data_map: {
    application: 'application',
    jobName: 'dataMapName',
    clearData: 'clearData',
    overrideMembersMap: 'overrideMembersMap',
    overrideExclusionMembersMap: 'overrideExclusionMembersMap',
  },
  oracle_epm_planning_list_user_variable_values: {
    application: 'application',
    offset: 'offset',
    limit: 'limit',
  },
  oracle_epm_planning_set_user_variable_values: {
    application: 'application',
    userVariableValues: 'userVariableValues',
  },
  oracle_epm_planning_list_planning_units: {
    application: 'application',
    scenario: 'scenario',
    planningVersion: 'planningVersion',
    offset: 'offset',
    limit: 'limit',
  },
  oracle_epm_planning_get_planning_unit_actions: {
    application: 'application',
    puhIdentifier: 'puhIdentifier',
    pmMembers: 'pmMembers',
    approvalOptions: 'approvalOptions',
  },
  oracle_epm_planning_get_planning_unit_history: {
    application: 'application',
    puIdentifier: 'puIdentifier',
    annotSeq: 'annotSeq',
    logSeq: 'logSeq',
    offset: 'offset',
    limit: 'limit',
  },
  oracle_epm_planning_change_planning_unit_status: {
    application: 'application',
    puhIdentifier: 'puhIdentifier',
    pmMembers: 'pmMembers',
    actionId: 'actionId',
    comments: 'comments',
  },
  oracle_epm_planning_get_insights: {
    application: 'application',
    cube: 'cube',
    insightSlice: 'insightSlice',
    retrievalMode: 'retrievalMode',
    calendar: 'calendar',
  },
  oracle_epm_planning_summarize_insights: {
    application: 'application',
    summaryInputMode: 'summaryInputMode',
    insightIds: 'insightIds',
    cube: 'cube',
    insightSlice: 'insightSlice',
    retrievalMode: 'retrievalMode',
    calendar: 'calendar',
    summarySize: 'summarySize',
  },
}
const JSON_FIELDS = new Set([
  'overrideMembersMap',
  'overrideExclusionMembersMap',
  'userVariableValues',
  'insightSlice',
  'insightIds',
  'variables',
  'parameters',
  'gridDefinition',
  'dataGrid',
  'importOptions',
])
const BOOLEAN_FIELDS = new Set([
  'clearData',
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
    if (params.operation === 'oracle_epm_planning_summarize_insights') {
      if (
        params.summaryInputMode === 'ids' &&
        ['cube', 'insightSlice', 'retrievalMode', 'calendar'].includes(wire)
      )
        continue
      if (params.summaryInputMode === 'slice' && wire === 'insightIds') continue
    }
    if (wire === 'calendar' && params.retrievalMode !== 'FORCE_RECOMPUTE') continue
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
    } else if (
      ['actionId', 'approvalOptions', 'annotSeq', 'logSeq', 'summarySize'].includes(wire)
    ) {
      result[wire] = parseOptionalNumberInput(value, field, {
        integer: true,
        min: wire === 'annotSeq' || wire === 'logSeq' ? -1 : wire === 'approvalOptions' ? 0 : 1,
        max:
          wire === 'approvalOptions' ? 1 : wire === 'summarySize' ? 10000 : Number.MAX_SAFE_INTEGER,
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
    'Manage Planning and FreeForm data, jobs, approvals, user variables and IPM insights',
  longDescription:
    'Connect an Oracle EPM service-account credential to Planning and FreeForm. Discover applications, cubes and dimensions; manage dynamic members and substitution variables; run rules and configured jobs; transfer data slices, forms and repository files; and perform explicit cube refresh and login-access changes. Run data maps with explicit target clearing, manage user-variable values, inspect owned planning units and perform explicit approval actions, and retrieve or summarize IPM insights. Planning application modules use tenant-configured cubes and rules, not separate integrations. Insight retrieval defaults to existing results; recomputation is explicit and permission-dependent. Job submission and waiting are separate. Inline results are limited to 16 MiB and downloaded Sim files to 100 MiB. Discovery permissions may be broader than execution permissions: manual names remain available.',
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
        oracle_epm_planning_run_data_map: [
          {
            text: 'Run data map',
            field: ['dataMapNameSelector', 'dataMapNameManual'],
            core: true,
          },
          {
            text: 'in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_list_user_variable_values: [
          {
            text: 'List user-variable values in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_set_user_variable_values: [
          {
            text: 'Set user-variable values in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_list_planning_units: [
          {
            text: 'List owned planning units in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_planning_get_planning_unit_actions: [
          {
            text: 'List available actions for',
            field: 'pmMembers',
            core: true,
          },
          {
            text: 'in',
            field: 'puhIdentifier',
            core: true,
          },
        ],
        oracle_epm_planning_get_planning_unit_history: [
          {
            text: 'Read history for',
            field: 'puIdentifier',
            core: true,
          },
        ],
        oracle_epm_planning_change_planning_unit_status: [
          {
            text: 'Apply action',
            field: 'actionId',
            core: true,
          },
          {
            text: 'to',
            field: 'pmMembers',
            core: true,
          },
          {
            text: 'in',
            field: 'puhIdentifier',
            core: true,
          },
        ],
        oracle_epm_planning_get_insights: [
          {
            text: 'Get insights for',
            field: 'insightSlice',
            core: true,
          },
          {
            text: 'in cube',
            field: ['cubeSelector', 'cubeManual'],
            core: true,
          },
        ],
        oracle_epm_planning_summarize_insights: [
          {
            text: 'Summarize insights using',
            field: 'summaryInputMode',
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
        { label: 'Run Data Map', id: 'oracle_epm_planning_run_data_map' },
        { label: 'List User Variable Values', id: 'oracle_epm_planning_list_user_variable_values' },
        { label: 'Set User Variable Values', id: 'oracle_epm_planning_set_user_variable_values' },
        { label: 'List Planning Units', id: 'oracle_epm_planning_list_planning_units' },
        { label: 'Get Planning Unit Actions', id: 'oracle_epm_planning_get_planning_unit_actions' },
        { label: 'Get Planning Unit History', id: 'oracle_epm_planning_get_planning_unit_history' },
        {
          label: 'Change Planning Unit Status',
          id: 'oracle_epm_planning_change_planning_unit_status',
        },
        { label: 'Get Insights', id: 'oracle_epm_planning_get_insights' },
        { label: 'Summarize Insights', id: 'oracle_epm_planning_summarize_insights' },
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
          'oracle_epm_planning_run_data_map',
          'oracle_epm_planning_list_user_variable_values',
          'oracle_epm_planning_set_user_variable_values',
          'oracle_epm_planning_list_planning_units',
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_get_planning_unit_history',
          'oracle_epm_planning_change_planning_unit_status',
          'oracle_epm_planning_get_insights',
          'oracle_epm_planning_summarize_insights',
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
          'oracle_epm_planning_run_data_map',
          'oracle_epm_planning_list_user_variable_values',
          'oracle_epm_planning_set_user_variable_values',
          'oracle_epm_planning_list_planning_units',
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_get_planning_unit_history',
          'oracle_epm_planning_change_planning_unit_status',
          'oracle_epm_planning_get_insights',
          'oracle_epm_planning_summarize_insights',
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
          'oracle_epm_planning_run_data_map',
          'oracle_epm_planning_list_user_variable_values',
          'oracle_epm_planning_set_user_variable_values',
          'oracle_epm_planning_list_planning_units',
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_get_planning_unit_history',
          'oracle_epm_planning_change_planning_unit_status',
          'oracle_epm_planning_get_insights',
          'oracle_epm_planning_summarize_insights',
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
          'oracle_epm_planning_run_data_map',
          'oracle_epm_planning_list_user_variable_values',
          'oracle_epm_planning_set_user_variable_values',
          'oracle_epm_planning_list_planning_units',
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_get_planning_unit_history',
          'oracle_epm_planning_change_planning_unit_status',
          'oracle_epm_planning_get_insights',
          'oracle_epm_planning_summarize_insights',
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
      condition: (values) => ({
        field: 'operation',
        value: [
          'oracle_epm_planning_get_insights',
          ...(values?.summaryInputMode === 'slice'
            ? ['oracle_epm_planning_summarize_insights']
            : []),
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
      }),
      required: (values) => ({
        field: 'operation',
        value: [
          ...(values?.summaryInputMode === 'slice'
            ? ['oracle_epm_planning_summarize_insights']
            : []),
          'oracle_epm_planning_get_insights',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
        ],
      }),
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
      condition: (values) => ({
        field: 'operation',
        value: [
          'oracle_epm_planning_get_insights',
          ...(values?.summaryInputMode === 'slice'
            ? ['oracle_epm_planning_summarize_insights']
            : []),
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
      }),
      required: (values) => ({
        field: 'operation',
        value: [
          ...(values?.summaryInputMode === 'slice'
            ? ['oracle_epm_planning_summarize_insights']
            : []),
          'oracle_epm_planning_get_insights',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_dimension',
          'oracle_epm_planning_export_data_slice',
          'oracle_epm_planning_import_data_slice',
          'oracle_epm_planning_clear_data_slice',
        ],
      }),
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
        value: [
          'oracle_epm_planning_list_user_variable_values',
          'oracle_epm_planning_list_planning_units',
          'oracle_epm_planning_get_planning_unit_history',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_job_details',
        ],
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
        value: [
          'oracle_epm_planning_list_user_variable_values',
          'oracle_epm_planning_list_planning_units',
          'oracle_epm_planning_get_planning_unit_history',
          'oracle_epm_planning_list_dimensions',
          'oracle_epm_planning_get_job_details',
        ],
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
    {
      id: 'objectType',
      title: 'Data Map Job Type',
      type: 'dropdown',
      options: [
        {
          label: 'Plan Type Map',
          id: 'PLAN_TYPE_MAP',
        },
      ],
      defaultValue: 'PLAN_TYPE_MAP',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      description: 'Discovery filter only. Run Data Map always submits PLAN_TYPE_MAP.',
    },
    {
      id: 'dataMapNameSelector',
      title: 'Data Map',
      type: 'project-selector',
      canonicalParamId: 'dataMapName',
      mode: 'basic',
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      serviceId: 'oracle-epm',
      selectorKey: 'oracleEpmPlanning.jobDefinitions',
      dependsOn: ['credential', 'applicationSelector', 'objectType'],
    },
    {
      id: 'dataMapNameManual',
      title: 'Data Map',
      type: 'short-input',
      canonicalParamId: 'dataMapName',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      placeholder: 'Enter a configured data-map job name',
    },
    {
      id: 'clearData',
      title: 'Clear Data',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      placeholder:
        'Explicitly clear the target region before copying. Destructive when true; Sim defaults to false, while Oracle defaults to true.',
      defaultValue: false,
    },
    {
      id: 'overrideMembersMap',
      title: 'Override Members Map (JSON)',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      required: false,
      placeholder:
        'Optional dimension-to-member-selection map, for example {"Period":"ILvl0Descendants(Q1)"}. Values must be strings.',
      language: 'json',
      canvasNoun: 'member selections',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate only the requested Oracle Planning JSON using supplied tenant names. Optional dimension-to-member-selection map, for example {"Period":"ILvl0Descendants(Q1)"}. Values must be strings. Return ONLY JSON; do not invent names or unsupported fields.',
        placeholder: 'Describe the requested overrideMembersMap',
      },
      mode: 'advanced',
    },
    {
      id: 'overrideExclusionMembersMap',
      title: 'Override Exclusion Members Map (JSON)',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_run_data_map'],
      },
      required: false,
      placeholder:
        'Optional dimension-to-excluded-member-selection map, for example {"Period":"Jan"}. Values must be strings.',
      language: 'json',
      canvasNoun: 'member selections',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate only the requested Oracle Planning JSON using supplied tenant names. Optional dimension-to-excluded-member-selection map, for example {"Period":"Jan"}. Values must be strings. Return ONLY JSON; do not invent names or unsupported fields.',
        placeholder: 'Describe the requested overrideExclusionMembersMap',
      },
      mode: 'advanced',
    },
    {
      id: 'userVariableValues',
      title: 'User Variable Values (JSON)',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_set_user_variable_values'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_set_user_variable_values'],
      },
      placeholder:
        '1–1000 user-variable values: [{userName, name, dimension, member}]. Names are tenant-specific; do not assume batch atomicity.',
      language: 'json',
      canvasNoun: 'user-variable values',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate only the requested Oracle Planning JSON using supplied tenant names. 1–1000 user-variable values: [{userName, name, dimension, member}]. Names are tenant-specific; do not assume batch atomicity. Return ONLY JSON; do not invent names or unsupported fields.',
        placeholder: 'Describe the requested userVariableValues',
      },
    },
    {
      id: 'scenario',
      title: 'Scenario',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_list_planning_units'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_list_planning_units'],
      },
      placeholder: 'Exact scenario member name for the planning units.',
    },
    {
      id: 'planningVersion',
      title: 'Planning Version',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_list_planning_units'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_list_planning_units'],
      },
      placeholder: 'Exact version member name for the planning units, not the REST API version.',
    },
    {
      id: 'puhIdentifier',
      title: 'Planning Unit Hierarchy',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_change_planning_unit_status',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_change_planning_unit_status',
        ],
      },
      placeholder:
        'Raw Oracle planning-unit hierarchy identifier for scenario and version, including required quotes and :: separators. Not a numeric puId or a URL. Maximum 255 UTF-8 bytes; do not percent-encode.',
    },
    {
      id: 'puIdentifier',
      title: 'Planning Unit Identifier',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_planning_unit_history'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_get_planning_unit_history'],
      },
      placeholder:
        'Raw Oracle compound planning-unit identifier including scenario, version and PM-member context. Not the numeric puId or a URL. Preserve its exact quoting/separators; maximum 255 UTF-8 bytes. Do not percent-encode.',
    },
    {
      id: 'pmMembers',
      title: 'PM Members',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_change_planning_unit_status',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_planning_get_planning_unit_actions',
          'oracle_epm_planning_change_planning_unit_status',
        ],
      },
      placeholder:
        'Oracle PM-member selection (Entity: Secondary member), preserving tenant-specific quoting and comma-separated member names.',
    },
    {
      id: 'actionId',
      title: 'Action ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_change_planning_unit_status'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_change_planning_unit_status'],
      },
      placeholder:
        'Explicit action ID returned by Get Planning Unit Actions, such as 6 for Promote. May change status or ownership.',
    },
    {
      id: 'comments',
      title: 'Comments',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_change_planning_unit_status'],
      },
      required: false,
      placeholder: 'Optional comment for the explicit approval transition.',
      mode: 'advanced',
    },
    {
      id: 'approvalOptions',
      title: 'Approval Options',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_planning_unit_actions'],
      },
      required: false,
      placeholder: '0 for limited approvals or 1 for full approvals (default 1).',
      mode: 'advanced',
    },
    {
      id: 'annotSeq',
      title: 'Annot Seq',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_planning_unit_history'],
      },
      required: false,
      placeholder:
        'Annotation sequence to retrieve replies; -1 (default) with logSeq -1 retrieves parent nodes.',
      mode: 'advanced',
    },
    {
      id: 'logSeq',
      title: 'Log Seq',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_planning_unit_history'],
      },
      required: false,
      placeholder:
        'History sequence to retrieve replies; -1 (default) with annotSeq -1 retrieves parent nodes.',
      mode: 'advanced',
    },
    {
      id: 'insightSlice',
      title: 'Insight Slice (JSON)',
      type: 'code',
      condition: (values) => ({
        field: 'operation',
        value:
          values?.operation === 'oracle_epm_planning_summarize_insights' &&
          values?.summaryInputMode !== 'slice'
            ? []
            : ['oracle_epm_planning_get_insights', 'oracle_epm_planning_summarize_insights'],
      }),
      required: (values) => ({
        field: 'operation',
        value:
          values?.operation === 'oracle_epm_planning_summarize_insights' &&
          values?.summaryInputMode !== 'slice'
            ? []
            : ['oracle_epm_planning_get_insights', 'oracle_epm_planning_summarize_insights'],
      }),
      placeholder:
        'IPM slice: pov {members:string[], dimensions:string[]}; rowAxisDefinition and columnAxisDefinition each {dimensions:string[], segments:string[][][]}. Not a Planning data grid.',
      language: 'json',
      canvasNoun: 'insight slice',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate only the requested Oracle Planning JSON using supplied tenant names. IPM slice: pov {members:string[], dimensions:string[]}; rowAxisDefinition and columnAxisDefinition each {dimensions:string[], segments:string[][][]}. Not a Planning data grid. Return ONLY JSON; do not invent names or unsupported fields.',
        placeholder: 'Describe the requested insightSlice',
      },
    },
    {
      id: 'retrievalMode',
      title: 'Retrieval Mode',
      type: 'dropdown',
      condition: (values) => ({
        field: 'operation',
        value:
          values?.operation === 'oracle_epm_planning_summarize_insights' &&
          values?.summaryInputMode !== 'slice'
            ? []
            : ['oracle_epm_planning_get_insights', 'oracle_epm_planning_summarize_insights'],
      }),
      required: false,
      placeholder:
        'USE_EXISTING (default) reads stored insights. FORCE_RECOMPUTE generates insights and requires a calendar and Administrator or IPM Manage role.',
      mode: 'advanced',
      defaultValue: 'USE_EXISTING',
      options: [
        {
          id: 'USE_EXISTING',
          label: 'Use Existing Insights',
        },
        {
          id: 'FORCE_RECOMPUTE',
          label: 'Recompute Insights',
        },
      ],
    },
    {
      id: 'calendar',
      title: 'Calendar',
      type: 'short-input',
      condition: (values) => ({
        field: 'operation',
        value:
          values?.operation === 'oracle_epm_planning_summarize_insights' &&
          values?.summaryInputMode !== 'slice'
            ? []
            : ['oracle_epm_planning_get_insights', 'oracle_epm_planning_summarize_insights'],
        and: { field: 'retrievalMode', value: 'FORCE_RECOMPUTE' },
      }),
      required: (values) => ({
        field: 'operation',
        value:
          values?.operation === 'oracle_epm_planning_summarize_insights' &&
          values?.summaryInputMode !== 'slice'
            ? []
            : ['oracle_epm_planning_get_insights', 'oracle_epm_planning_summarize_insights'],
        and: { field: 'retrievalMode', value: 'FORCE_RECOMPUTE' },
      }),
      placeholder:
        'Tenant calendar name, required only when generating insights with FORCE_RECOMPUTE.',
      mode: 'advanced',
    },
    {
      id: 'insightIds',
      title: 'Insight IDs (JSON)',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_summarize_insights'],
        and: { field: 'summaryInputMode', value: 'ids' },
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_summarize_insights'],
        and: { field: 'summaryInputMode', value: 'ids' },
      },
      placeholder:
        '1–1000 insight ID strings returned by Get Insights; required in ids summary mode.',
      language: 'json',
      canvasNoun: 'member selections',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate only the requested Oracle Planning JSON using supplied tenant names. 1–1000 insight ID strings returned by Get Insights; required in ids summary mode. Return ONLY JSON; do not invent names or unsupported fields.',
        placeholder: 'Describe the requested insightIds',
      },
    },
    {
      id: 'summaryInputMode',
      title: 'Summary Input Mode',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_summarize_insights'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_planning_summarize_insights'],
      },
      placeholder:
        'ids summarizes explicit insight IDs; slice summarizes an insight slice and requires cube plus insightSlice.',
      defaultValue: 'ids',
      options: [
        {
          id: 'ids',
          label: 'Insight IDs',
        },
        {
          id: 'slice',
          label: 'Insight Slice',
        },
      ],
    },
    {
      id: 'summarySize',
      title: 'Summary Size',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_summarize_insights'],
      },
      required: false,
      placeholder:
        'Maximum summary length in words (default 100; Sim range 1–10000). Output format is always text.',
      mode: 'advanced',
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
      'oracle_epm_planning_run_data_map',
      'oracle_epm_planning_list_user_variable_values',
      'oracle_epm_planning_set_user_variable_values',
      'oracle_epm_planning_list_planning_units',
      'oracle_epm_planning_get_planning_unit_actions',
      'oracle_epm_planning_get_planning_unit_history',
      'oracle_epm_planning_change_planning_unit_status',
      'oracle_epm_planning_get_insights',
      'oracle_epm_planning_summarize_insights',
    ],
    config: { tool: (params) => params.operation, params: operationParams },
  },
  inputs: {
    clearData: {
      type: 'boolean',
      description:
        'Explicitly clear the target region before copying. Destructive when true; Sim defaults to false, while Oracle defaults to true.',
    },
    overrideMembersMap: {
      type: 'json',
      description:
        'Optional dimension-to-member-selection map, for example {"Period":"ILvl0Descendants(Q1)"}. Values must be strings.',
    },
    overrideExclusionMembersMap: {
      type: 'json',
      description:
        'Optional dimension-to-excluded-member-selection map, for example {"Period":"Jan"}. Values must be strings.',
    },
    userVariableValues: {
      type: 'array',
      description:
        '1–1000 user-variable values: [{userName, name, dimension, member}]. Names are tenant-specific; do not assume batch atomicity.',
    },
    scenario: {
      type: 'string',
      description: 'Exact scenario member name for the planning units.',
    },
    planningVersion: {
      type: 'string',
      description: 'Exact version member name for the planning units, not the REST API version.',
    },
    puhIdentifier: {
      type: 'string',
      description:
        'Raw Oracle planning-unit hierarchy identifier for scenario and version, including required quotes and :: separators. Not a numeric puId or a URL. Maximum 255 UTF-8 bytes; do not percent-encode.',
    },
    puIdentifier: {
      type: 'string',
      description:
        'Raw Oracle compound planning-unit identifier including scenario, version and PM-member context. Not the numeric puId or a URL. Preserve its exact quoting/separators; maximum 255 UTF-8 bytes. Do not percent-encode.',
    },
    pmMembers: {
      type: 'string',
      description:
        'Oracle PM-member selection (Entity: Secondary member), preserving tenant-specific quoting and comma-separated member names.',
    },
    actionId: {
      type: 'number',
      description:
        'Explicit action ID returned by Get Planning Unit Actions, such as 6 for Promote. May change status or ownership.',
    },
    comments: {
      type: 'string',
      description: 'Optional comment for the explicit approval transition.',
    },
    approvalOptions: {
      type: 'number',
      description: '0 for limited approvals or 1 for full approvals (default 1).',
    },
    annotSeq: {
      type: 'number',
      description:
        'Annotation sequence to retrieve replies; -1 (default) with logSeq -1 retrieves parent nodes.',
    },
    logSeq: {
      type: 'number',
      description:
        'History sequence to retrieve replies; -1 (default) with annotSeq -1 retrieves parent nodes.',
    },
    insightSlice: {
      type: 'json',
      description:
        'IPM slice: pov {members:string[], dimensions:string[]}; rowAxisDefinition and columnAxisDefinition each {dimensions:string[], segments:string[][][]}. Not a Planning data grid.',
    },
    retrievalMode: {
      type: 'string',
      description:
        'USE_EXISTING (default) reads stored insights. FORCE_RECOMPUTE generates insights and requires a calendar and Administrator or IPM Manage role.',
    },
    calendar: {
      type: 'string',
      description:
        'Tenant calendar name, required only when generating insights with FORCE_RECOMPUTE.',
    },
    insightIds: {
      type: 'array',
      description:
        '1–1000 insight ID strings returned by Get Insights; required in ids summary mode.',
    },
    summaryInputMode: {
      type: 'string',
      description:
        'ids summarizes explicit insight IDs; slice summarizes an insight slice and requires cube plus insightSlice.',
    },
    summarySize: {
      type: 'number',
      description:
        'Maximum summary length in words (default 100; Sim range 1–10000). Output format is always text.',
    },
    dataMapName: {
      type: 'string',
      description: 'Configured data-map job name',
    },
    objectType: {
      type: 'string',
      description: 'Data-map discovery filter PLAN_TYPE_MAP',
    },
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
    userVariableValues: {
      type: 'array',
      description: 'One page of user-variable values; Oracle provides no completion flag',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_list_user_variable_values'],
      },
    },
    planningUnits: {
      type: 'array',
      description: 'One page of owned planning units; numeric puId is not a compound identifier',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_list_planning_units'],
      },
    },
    planningUnitActions: {
      type: 'array',
      description: 'Available actions without performing any transition',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_planning_unit_actions'],
      },
    },
    planningUnitHistory: {
      type: 'array',
      description: 'One page of owned-unit history and annotations',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_planning_unit_history'],
      },
    },
    planningUnitAction: {
      type: 'json',
      description: 'Oracle confirmation returned in self-link data, not a job snapshot',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_change_planning_unit_status'],
      },
    },
    insights: {
      type: 'array',
      description:
        'IPM insights in this response; inspect hasMore before treating the results as complete',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_get_insights'],
      },
    },
    summary: {
      type: 'string',
      description: 'Oracle IPM summary in text format',
      condition: {
        field: 'operation',
        value: ['oracle_epm_planning_summarize_insights'],
      },
    },
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
      description: 'Total dimension or insight count reported by Oracle',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_dimensions', 'oracle_epm_planning_get_insights'] },
    },
    hasMore: {
      type: 'boolean',
      description: 'Additional results exist; insights do not expose a documented pagination input',
      condition: { field: 'operation', value: ['oracle_epm_planning_list_dimensions', 'oracle_epm_planning_get_insights'] },
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
      description:
        'Oracle accepted the variable update request; user-variable batches have no atomicity guarantee',
      condition: { field: 'operation', value: ['oracle_epm_planning_set_substitution_variables', 'oracle_epm_planning_set_user_variable_values'] },
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
          'oracle_epm_planning_run_data_map',
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
      title: 'Push an approved data map',
      prompt:
        'Build a workflow that selects a configured PLAN_TYPE_MAP job, requires an explicit clearData choice defaulting to false, submits only supplied dimension overrides, and waits for the returned job ID. Never replay the submission automatically.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Maintain user-specific planning context',
      prompt:
        'Build a workflow that pages user-variable values, updates only an explicitly approved batch of userName/name/dimension/member entries, then reads the relevant values again. Respect caller permissions and do not assume the batch is transactional.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review owned planning units',
      prompt:
        'Build a workflow that lists owned planning units for supplied scenario and version names, reads their history using exact manual compound identifiers, and retrieves available actions. Perform a status or ownership change only after an explicit choice and approval. Never treat puId as the compound path identifier.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Summarize existing planning insights',
      prompt:
        'Build a workflow that retrieves IPM insights with USE_EXISTING and an insight-specific slice, reports hasMore and totalResults without claiming incomplete results are complete, then summarizes selected insight ID strings as text. Never recompute insights implicitly.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
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
