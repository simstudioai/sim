/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
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
