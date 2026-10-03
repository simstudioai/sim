/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { OracleEpmPlanningBlock } from '@/blocks/blocks/oracle_epm_planning'
import { oracleEpmPlanningDownloadFileTool } from '@/tools/oracle_epm_planning/download_file'
import { oracleEpmPlanningExportDataSliceTool } from '@/tools/oracle_epm_planning/export_data_slice'
import { oracleEpmPlanningExportFormDataTool } from '@/tools/oracle_epm_planning/export_form_data'
import { oracleEpmPlanningGetJobTool } from '@/tools/oracle_epm_planning/get_job'
import { oracleEpmPlanningImportDataSliceTool } from '@/tools/oracle_epm_planning/import_data_slice'
import { oracleEpmPlanningUploadFileTool } from '@/tools/oracle_epm_planning/upload_file'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'

function mapped(input: Record<string, unknown>) {
  const transform = OracleEpmPlanningBlock.tools.config.params!
  return { ...input, ...transform(input) }
}
describe('Planning public metadata and late input normalization', () => {
  it('reuses bounded job discovery for data maps and preserves manual job names', () => {
    const values = {
      operation: 'oracle_epm_planning_run_data_map',
      credential: 'credential-1',
      applicationSelector: 'Vision',
      objectType: 'PLAN_TYPE_MAP',
      jobType: 'Stale',
    }
    const selector = OracleEpmPlanningBlock.subBlocks.find(
      (field) => field.id === 'dataMapNameSelector'
    )!
    expect(
      buildSelectorContextFromValues({
        selectorKey: 'oracleEpmPlanning.jobDefinitions',
        contextConfigs: getSelectorContextSubBlocks(OracleEpmPlanningBlock.subBlocks, values),
        values,
        dependsOn: selector.dependsOn as string[],
      })
    ).toMatchObject({
      projectId: 'Vision',
      objectType: 'PLAN_TYPE_MAP',
      oauthCredential: 'credential-1',
    })
    expect(mapped({ ...values, dataMapName: 'Manual Map', clearData: false })).toMatchObject({
      jobName: 'Manual Map',
      clearData: false,
    })
    expect(
      OracleEpmPlanningBlock.subBlocks.find((field) => field.id === 'clearData')?.defaultValue
    ).toBe(false)
  })
  it('parses nested data-map overrides late without leaking generic job fields', () => {
    const result = mapped({
      operation: 'oracle_epm_planning_run_data_map',
      dataMapName: 'Reporting',
      clearData: 'false',
      overrideMembersMap: '{"Period":"ILvl0Descendants(Q1)"}',
      overrideExclusionMembersMap: { Period: 'Jan' },
      parameters: { stale: true },
    })
    expect(result).toMatchObject({
      jobName: 'Reporting',
      clearData: false,
      overrideMembersMap: { Period: 'ILvl0Descendants(Q1)' },
      overrideExclusionMembersMap: { Period: 'Jan' },
    })
    expect(result.parameters).toBeUndefined()
    expect(() =>
      mapped({ operation: 'oracle_epm_planning_run_data_map', clearData: 'yes' })
    ).toThrow()
  })
  it('discards inactive summary inputs before parsing stale JSON or recompute settings', () => {
    const ids = mapped({
      operation: 'oracle_epm_planning_summarize_insights',
      summaryInputMode: 'ids',
      insightIds: '["426"]',
      insightSlice: '{invalid',
      cube: 'Stale',
      retrievalMode: 'FORCE_RECOMPUTE',
      calendar: 'Stale',
    })
    expect(ids.insightIds).toEqual(['426'])
    for (const field of ['insightSlice', 'cube', 'retrievalMode', 'calendar'])
      expect(ids[field]).toBeUndefined()
    const slice = mapped({
      operation: 'oracle_epm_planning_summarize_insights',
      summaryInputMode: 'slice',
      insightSlice: '{}',
      insightIds: '{invalid',
      retrievalMode: 'USE_EXISTING',
      calendar: 'Stale',
    })
    expect(slice.insightSlice).toEqual({})
    expect(slice.insightIds).toBeUndefined()
    expect(slice.calendar).toBeUndefined()
  })
  it('shows and requires insight inputs only for their active summary mode', () => {
    const fields = OracleEpmPlanningBlock.subBlocks
    const visible = (id: string, values: Record<string, unknown>) =>
      evaluateSubBlockCondition(fields.find((field) => field.id === id)!.condition, values)
    const ids = {
      operation: 'oracle_epm_planning_summarize_insights',
      summaryInputMode: 'ids',
      retrievalMode: 'FORCE_RECOMPUTE',
    }
    for (const field of ['cubeSelector', 'cubeManual', 'insightSlice', 'retrievalMode', 'calendar'])
      expect(visible(field, ids)).toBe(false)
    expect(visible('insightIds', ids)).toBe(true)
    const slice = { ...ids, summaryInputMode: 'slice' }
    for (const field of ['cubeSelector', 'cubeManual', 'insightSlice', 'retrievalMode', 'calendar'])
      expect(visible(field, slice)).toBe(true)
    expect(visible('insightIds', slice)).toBe(false)
    expect(visible('calendar', { ...slice, retrievalMode: 'USE_EXISTING' })).toBe(false)
    expect(visible('insightSlice', { ...ids, operation: 'oracle_epm_planning_get_insights' })).toBe(
      true
    )
    for (const field of ['cubeSelector', 'cubeManual', 'insightSlice']) {
      const required = fields.find((item) => item.id === field)!.required
      expect(
        typeof required === 'function' ? evaluateSubBlockCondition(required, slice) : required
      ).toBe(true)
    }
  })
  it('coerces approval numbers without changing compound identifier text', () => {
    const puhIdentifier = 'Forecast::"Working"'
    expect(
      mapped({
        operation: 'oracle_epm_planning_change_planning_unit_status',
        puhIdentifier,
        actionId: '6',
        pmMembers: 'Sales & Marketing',
      })
    ).toMatchObject({ puhIdentifier, actionId: 6, pmMembers: 'Sales & Marketing' })
    expect(
      mapped({
        operation: 'oracle_epm_planning_get_planning_unit_history',
        annotSeq: '-1',
        logSeq: '2',
      })
    ).toMatchObject({ annotSeq: -1, logSeq: 2 })
    expect(() =>
      mapped({ operation: 'oracle_epm_planning_get_planning_unit_actions', approvalOptions: '2' })
    ).toThrow()
  })
  it('accepts the numeric job ID returned by a preceding submission', () => {
    expect(mapped({ operation: 'oracle_epm_planning_wait_for_job', jobId: 42 }).jobId).toBe('42')
    expect(mapped({ operation: 'oracle_epm_planning_wait_for_job', jobId: '42' }).jobId).toBe('42')
    expect(() => mapped({ operation: 'oracle_epm_planning_wait_for_job', jobId: 1.5 })).toThrow(
      'safe integer'
    )
  })
  it('keeps service-account material executor-injected and destination hidden', () => {
    expect(oracleEpmPlanningAuthParamFields.oauthCredential).toMatchObject({
      required: true,
      visibility: 'user-only',
    })
    expect(oracleEpmPlanningAuthParamFields.accessToken.visibility).toBe('hidden')
    expect(oracleEpmPlanningAuthParamFields.instanceUrl.visibility).toBe('hidden')
  })
  it('parses resolved JSON, numbers and booleans without parsing in tool selection', () => {
    const result = mapped({
      operation: 'oracle_epm_planning_list_dimensions',
      application: 'Vision',
      cube: 'Plan1',
      offset: '25',
      limit: '100',
    })
    expect(result).toMatchObject({ offset: 25, limit: 100 })
    expect(
      mapped({
        operation: 'oracle_epm_planning_run_rule',
        ruleName: 'Calc',
        parameters: '{"Year":"FY26"}',
      })
    ).toMatchObject({ jobName: 'Calc', parameters: { Year: 'FY26' } })
    expect(
      mapped({
        operation: 'oracle_epm_planning_list_substitution_variables',
        derivedValues: 'false',
      }).derivedValues
    ).toBe(false)
    expect(
      OracleEpmPlanningBlock.tools.config.tool({
        operation: 'oracle_epm_planning_import_data_slice',
        dataGrid: '{{unresolved}}',
      })
    ).toBe('oracle_epm_planning_import_data_slice')
  })
  it('clears inactive fields and maps operation-specific names explicitly', () => {
    const result = mapped({
      operation: 'oracle_epm_planning_run_rule',
      ruleName: 'Correct',
      jobName: 'Stale',
      configuredJobName: 'StaleConfig',
      gridDefinition: 'stale',
    })
    expect(result.jobName).toBe('Correct')
    expect(result.gridDefinition).toBeUndefined()
    expect(
      mapped({ operation: 'oracle_epm_planning_run_rule', jobName: 'Stale' }).jobName
    ).toBeUndefined()
    expect(
      mapped({ operation: 'oracle_epm_planning_refresh_cube', configuredJobName: 'Refresh' })
        .jobName
    ).toBe('Refresh')
    expect(
      mapped({
        operation: 'oracle_epm_planning_upload_file',
        destinationFileName: 'new.csv',
        fileName: 'old.csv',
      }).fileName
    ).toBe('new.csv')
  })
  it('normalizes exactly one UserFile from basic and advanced input', () => {
    const file = {
      id: 'file-1',
      name: 'data.csv',
      key: 'workspace/data.csv',
      url: 'https://storage.example.com/file',
      size: 3,
      type: 'text/csv',
    }
    for (const value of [file, [file], JSON.stringify(file)]) {
      expect(mapped({ operation: 'oracle_epm_planning_upload_file', file: value }).file).toEqual(
        file
      )
    }
    expect(() =>
      mapped({ operation: 'oracle_epm_planning_upload_file', file: [file, file] })
    ).toThrow('exactly one')
    const params = { oauthCredential: 'credential-1', file, _context: { userId: 'untrusted' } }
    expect(oracleEpmPlanningUploadFileTool.operation.input(params)).not.toHaveProperty('_context')
  })
  it('preserves direct typed agent inputs when no editor operation is present', () => {
    const input = {
      oauthCredential: 'credential-1',
      application: 'Vision',
      jobName: 'Calc',
      parameters: { Year: 'FY26' },
    }
    expect(mapped(input)).toEqual(input)
  })
  it('rejects invalid late coercion instead of dropping it silently', () => {
    expect(() =>
      mapped({ operation: 'oracle_epm_planning_run_job', parameters: '{broken' })
    ).toThrow('valid JSON')
    expect(() =>
      mapped({ operation: 'oracle_epm_planning_list_dimensions', limit: '-1' })
    ).toThrow()
    expect(() =>
      mapped({ operation: 'oracle_epm_planning_list_substitution_variables', derivedValues: 'yes' })
    ).toThrow('true or false')
  })
  it('describes structured contracts and the distinct form and grid POV shapes', () => {
    expect(oracleEpmPlanningGetJobTool.outputs!.job.properties!.jobId.type).toBe('number')
    expect(oracleEpmPlanningExportFormDataTool.outputs!.formData.properties!.pov.type).toBe(
      'object'
    )
    expect(oracleEpmPlanningExportDataSliceTool.outputs!.dataGrid.properties!.pov.type).toBe(
      'array'
    )
    expect(
      oracleEpmPlanningImportDataSliceTool.outputs!.importResult.properties!.numRejectedCells.type
    ).toBe('number')
    expect(oracleEpmPlanningParamFields.file.description).toContain('5 GiB')
    expect(oracleEpmPlanningDownloadFileTool.outputs!.file.description).toContain('100 MiB')
  })
})
