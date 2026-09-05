/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { buildSelectorContextFromValues, projectSelectorContext } from '@/lib/selectors/context'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import {
  OracleEpmTaxReportingBlock,
  OracleEpmTaxReportingBlockMeta,
} from '@/blocks/blocks/oracle_epm_tax_reporting'
import * as toolExports from '@/tools/oracle_epm_tax_reporting'
import { taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'

const block = OracleEpmTaxReportingBlock
const tools = Object.values(toolExports)

describe('Tax Reporting integration contracts', () => {
  it.each(['import_supplemental_collection_data', 'deploy_form_templates'])(
    'maps only the supplemental submission label for %s',
    (operation) => {
      const params = {
        operation: `oracle_epm_tax_reporting_${operation}`,
        oauthCredential: 'credential',
        jobName: 'Stale saved rule',
        submissionName: '<trigger.label>',
      }
      expect(block.tools.config.params?.(params)).toEqual({
        oauthCredential: 'credential',
        jobName: '<trigger.label>',
      })
      expect(block.tools.config.params?.({ ...params, submissionName: '' })).toEqual({
        oauthCredential: 'credential',
      })
      expect(
        block.tools.config.params?.({ ...params, operation: 'oracle_epm_tax_reporting_run_rule' })
      ).toEqual({ oauthCredential: 'credential', jobName: 'Stale saved rule' })
    }
  )

  it('derives report enums from the current block values wrapper', () => {
    const format = block.subBlocks.find((item) => item.id === 'format')!
    const module = block.subBlocks.find((item) => item.id === 'module')!
    if (typeof format.options !== 'function' || typeof module.options !== 'function')
      throw new Error('Expected derived options')
    const values = { operation: 'oracle_epm_tax_reporting_generate_user_details_report' }
    expect(format.options({ values }).map((option) => option.id)).toEqual(['', 'CSV', 'XLS'])
    expect(
      module
        .options({ values: { operation: 'oracle_epm_tax_reporting_generate_report' } })
        .map((option) => option.id)
    ).toEqual(['FCM', 'SDM'])
    expect(
      module
        .options({ values: { operation: 'oracle_epm_tax_reporting_get_report_status' } })
        .map((option) => option.id)
    ).toEqual(['FCCS', 'SDM'])
  })

  it('requires the active application and report module according to their route family', () => {
    const required = (id: string, values: Record<string, unknown>) => {
      const config = block.subBlocks.find((item) => item.id === id)!
      return typeof config.required === 'boolean'
        ? config.required
        : evaluateSubBlockCondition(config.required, values)
    }
    for (const id of ['applicationSelector', 'applicationManual']) {
      for (const family of [undefined, 'planning', 'supplemental_collection']) {
        expect(
          required(id, { operation: 'oracle_epm_tax_reporting_get_job_status', jobFamily: family })
        ).toBe(true)
      }
      expect(
        required(id, {
          operation: 'oracle_epm_tax_reporting_get_job_status',
          jobFamily: 'supplemental_dimension',
        })
      ).toBe(false)
      expect(
        required(id, {
          operation: 'oracle_epm_tax_reporting_run_rule',
          jobFamily: 'supplemental_dimension',
        })
      ).toBe(true)
    }
    for (const route of [undefined, 'standalone', 'generated_report']) {
      expect(
        required('module', {
          operation: 'oracle_epm_tax_reporting_get_report_status',
          reportStatusRoute: route,
        })
      ).toBe(true)
    }
    expect(
      required('module', {
        operation: 'oracle_epm_tax_reporting_get_report_status',
        reportStatusRoute: 'user_details',
      })
    ).toBe(false)
    expect(
      required('module', {
        operation: 'oracle_epm_tax_reporting_generate_report',
        reportStatusRoute: 'user_details',
      })
    ).toBe(true)
  })

  it('advertises only the documented output family for files, reports, and planning jobs', () => {
    const outputs = (id: string) =>
      tools.find((tool) => tool.id === `oracle_epm_tax_reporting_${id}`)!.outputs!
    expect(Object.keys(outputs('upload_file')).sort()).toEqual(['details', 'links', 'status'])
    expect(outputs('generate_report')).not.toHaveProperty('jobName')
    expect(outputs('generate_report')).not.toHaveProperty('descriptiveStatus')
    expect(outputs('get_job_status')).toHaveProperty('detailedStatus')
    expect(outputs('run_rule')).toHaveProperty('waitOutcome')
  })

  it('exposes exactly 27 reachable in-process tools with protected credential inputs', () => {
    expect(tools).toHaveLength(27)
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(27)
    expect([...block.tools.access].sort()).toEqual(tools.map((tool) => tool.id).sort())
    for (const tool of tools) {
      expect(tool.request).toBeUndefined()
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool.oauth).toEqual(taxOAuth)
      expect(tool.params.oauthCredential).toMatchObject({ required: true, visibility: 'user-only' })
      for (const field of ['accessToken', 'instanceUrl'])
        expect(tool.params[field].visibility).toBe('hidden')
      for (const [key, field] of Object.entries(tool.params)) {
        expect(field.required, `${tool.id}.${key}`).toBeTypeOf('boolean')
        expect(field.description, `${tool.id}.${key}`).toBeTruthy()
      }
      expect(Object.keys(tool.outputs ?? {}).length).toBeGreaterThan(0)
      expect(block.canvasPresentation?.sentences?.byOperation?.[tool.id]).toBeDefined()
    }
  })

  it('aligns canonical inputs and source-file pairs with the tool contracts', () => {
    const canonical = buildCanonicalIndex(block.subBlocks)
    for (const id of ['oauthCredential', 'application', 'jobName', 'file']) {
      expect(canonical.groupsById[id]).toBeDefined()
      expect(block.subBlocks.some((subBlock) => subBlock.id === id)).toBe(false)
      expect(block.inputs[id]).toBeDefined()
    }
    for (const tool of tools) {
      for (const [key, param] of Object.entries(tool.params)) {
        if (param.required && param.visibility !== 'hidden')
          expect(block.inputs[key], `${tool.id}.${key}`).toBeDefined()
      }
    }
  })

  it('selects a tool before coercion and only serializes active operation fields afterward', () => {
    const params = {
      operation: 'oracle_epm_tax_reporting_run_rule',
      oauthCredential: 'credential',
      application: 'Tax',
      jobName: '<trigger.rule>',
      parameters: '{"Entity":"<trigger.entity>"}',
      waitForCompletion: 'false',
      profileName: 'stale destructive profile',
    }
    expect(block.tools.config.tool(params)).toBe(params.operation)
    expect(params.parameters).toBe('{"Entity":"<trigger.entity>"}')
    expect(block.tools.config.params?.(params)).toEqual({
      oauthCredential: 'credential',
      application: 'Tax',
      jobName: '<trigger.rule>',
      parameters: { Entity: '<trigger.entity>' },
      waitForCompletion: false,
    })
  })

  it('uses active canonical application values when building dependent job selectors', () => {
    const result = buildSelectorContextFromValues({
      selectorKey: 'oracle_epm_tax_reporting.jobDefinitions',
      contextConfigs: block.subBlocks,
      dependsOn: ['oauthCredential', 'application', 'jobType', 'operation'],
      values: {
        operation: 'oracle_epm_tax_reporting_run_rule',
        credential: 'credential',
        applicationSelector: 'Tax',
        applicationManual: 'stale',
        jobNameSelector: '',
      },
    })
    expect(result).toMatchObject({
      oauthCredential: 'credential',
      projectId: 'Tax',
      objectType: 'oracle_epm_tax_reporting_run_rule',
    })
    expect(
      projectSelectorContext('oracle_epm_tax_reporting.jobDefinitions', {
        application: '<trigger.application>',
        operation: 'oracle_epm_tax_reporting_run_rule',
        instanceUrl: 'https://forged.example.com',
      })
    ).not.toHaveProperty('projectId')
    expect(result).not.toHaveProperty('instanceUrl')
  })

  it('provides grounded reusable workflows without a separate hand-written setup page', () => {
    expect(OracleEpmTaxReportingBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    expect(OracleEpmTaxReportingBlockMeta.skills.length).toBeGreaterThanOrEqual(5)
    expect(block.longDescription).toContain('service-account credential')
    expect(block.longDescription).toContain('Data Integration')
  })
})
