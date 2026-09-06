/** @vitest-environment node */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import {
  OracleEpmPlanningBlock,
  OracleEpmPlanningBlockMeta,
} from '@/blocks/blocks/oracle_epm_planning'
import type { SubBlockConfig } from '@/blocks/types'
import toolMetadata from '@/tools/generated/tool-metadata'
import * as tools from '@/tools/oracle_epm_planning'
import { hasToolId } from '@/tools/tool-ids'
import type { InternalToolConfig } from '@/tools/types'

const EXPECTED_IDS = [
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
]
const FIELD_MAPPING: Record<string, Record<string, string>> = {
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
const allTools: InternalToolConfig[] = Object.values(tools)
const block = OracleEpmPlanningBlock
function operationMatches(
  value: SubBlockConfig['condition'] | SubBlockConfig['required'],
  operation: string
): boolean {
  if (value === true || value === undefined) return true
  if (!value) return false
  if (typeof value === 'function')
    return operationMatches(
      value({ operation, summaryInputMode: 'slice', retrievalMode: 'FORCE_RECOMPUTE' }),
      operation
    )
  return (Array.isArray(value.value) ? value.value : [value.value]).includes(operation)
}
describe('Planning integration surface (NetSuite whole-integration precedent)', () => {
  it('registers exactly the agreed 38 actions, with complete generated metadata', () => {
    expect(allTools).toHaveLength(38)
    expect(block.tools.access).toEqual(EXPECTED_IDS)
    expect(allTools.map((tool) => tool.id).sort()).toEqual([...EXPECTED_IDS].sort())
    expect(
      block.subBlocks.find((field) => field.id === 'operation')?.options?.map((option) => option.id)
    ).toEqual(EXPECTED_IDS)
    const registry = readFileSync(resolve(process.cwd(), 'tools/registry.ts'), 'utf8')
    const internalRegistry = readFileSync(
      resolve(process.cwd(), 'lib/internal/tool-operations/registry.server.ts'),
      'utf8'
    )
    for (const id of EXPECTED_IDS) {
      expect(block.tools.config.tool({ operation: id })).toBe(id)
      expect(hasToolId(id)).toBe(true)
      expect(toolMetadata[id]?.id).toBe(id)
      expect(registry).toContain(`${id}:`)
      expect(internalRegistry).toContain(`'${id}'`)
    }
  })
  it('aligns required visible inputs and exact output facets for every action', () => {
    for (const tool of allTools) {
      for (const [name, parameter] of Object.entries(tool.params)) {
        if (parameter.visibility === 'hidden') continue
        const blockField = FIELD_MAPPING[tool.id][name] ?? name
        expect(block.inputs[blockField]?.type, `${tool.id}.${name}`).toBe(parameter.type)
        const visible = block.subBlocks.filter(
          (field) =>
            (field.canonicalParamId ?? field.id) === blockField &&
            operationMatches(field.condition, tool.id)
        )
        expect(visible.length, tool.id + '.' + name).toBeGreaterThan(0)
        if (parameter.required)
          expect(
            visible.some((field) => field.required && operationMatches(field.required, tool.id))
          ).toBe(true)
      }
      for (const [name, output] of Object.entries(tool.outputs ?? {})) {
        const blockOutput = block.outputs[name]
        expect(blockOutput, tool.id + '.' + name).toBeDefined()
        expect(blockOutput.type).toBe(output.type)
        expect(blockOutput.condition).toEqual(
          expect.objectContaining({ value: expect.arrayContaining([tool.id]) })
        )
      }
    }
  })
  it('keeps canonical pairs distinct, mode-complete, and equally required', () => {
    const ids = block.subBlocks.map((field) => field.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = buildCanonicalIndex(block.subBlocks).groupsById
    expect(Object.keys(groups).sort()).toEqual(
      [
        'application',
        'cube',
        'dataMapName',
        'dimension',
        'file',
        'fileName',
        'jobName',
        'oauthCredential',
        'ruleName',
        'rulesetName',
      ].sort()
    )
    for (const [name, group] of Object.entries(groups)) {
      expect(ids).not.toContain(name)
      expect(group.basicId).toBeTruthy()
      expect(group.advancedIds).toHaveLength(1)
      const members = block.subBlocks.filter((field) => field.canonicalParamId === name)
      expect(new Set(members.map((field) => JSON.stringify(field.condition))).size).toBe(1)
      expect(new Set(members.map((field) => JSON.stringify(field.required))).size).toBe(1)
    }
  })
  it('reuses the Oracle icon and existing service-account credential', () => {
    const credential = block.subBlocks.find((field) => field.id === 'credential')
    expect(credential).toMatchObject({ serviceId: 'oracle-epm', credentialKind: 'service-account' })
    expect(OracleEpmPlanningBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    expect(OracleEpmPlanningBlockMeta.skills.length).toBeGreaterThanOrEqual(5)
    expect(block.icon).toBe(OracleEpmPlanningBlockMeta.templates[0].icon)
  })
  it('has a canvas sentence for all 38 operations', () => {
    expect(Object.keys(block.canvasPresentation!.sentences!.byOperation!)).toEqual(EXPECTED_IDS)
  })
})
