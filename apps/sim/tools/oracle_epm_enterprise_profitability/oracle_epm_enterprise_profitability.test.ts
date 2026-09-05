/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { NetSuiteIcon } from '@/components/icons'
import { getInternalToolOperationHandler } from '@/lib/internal/tool-operations/registry.server'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import {
  OracleEpcmBlock,
  OracleEpcmBlockMeta,
} from '@/blocks/blocks/oracle_epm_enterprise_profitability'
import * as oracleEpcmTools from '@/tools/oracle_epm_enterprise_profitability'
import { hasToolId } from '@/tools/tool-ids'

const tools = Object.values(oracleEpcmTools)
const prefix = 'oracle_epm_enterprise_profitability_'
const exchange = ['import_data', 'export_data', 'import_metadata', 'export_metadata']
const repository = ['import_data', 'import_metadata', 'download_file', 'delete_file']

function blockParam(operation: string, param: string): string {
  const action = operation.slice(prefix.length)
  if (param === 'jobName') return exchange.includes(action) ? 'jobName' : 'jobLabel'
  if (param === 'fileName')
    return repository.includes(action) ? 'repositoryFileName' : 'outputFileName'
  if (param === 'jobType')
    return action === 'list_job_definitions' ? 'jobType' : 'diagnosticJobType'
  return param
}

describe('Oracle EPCM integration surface', () => {
  it('registers exactly the agreed 24 tools with no transport or arbitrary-request escape hatch', async () => {
    expect(tools).toHaveLength(24)
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(24)
    expect([...OracleEpcmBlock.tools.access].sort()).toEqual(tools.map((tool) => tool.id).sort())
    const operation = OracleEpcmBlock.subBlocks.find((field) => field.id === 'operation')
    expect(
      Array.isArray(operation?.options) ? operation.options.map((option) => option.id).sort() : []
    ).toEqual(tools.map((tool) => tool.id).sort())
    for (const tool of tools) {
      expect(OracleEpcmBlock.tools.config.tool({ operation: tool.id })).toBe(tool.id)
      expect(tool.operation).toBeDefined()
      expect(await getInternalToolOperationHandler(tool.id)).toBeTypeOf('function')
      expect(hasToolId(tool.id)).toBe(true)
    }
  })

  it.each(tools)('makes required inputs reachable for $id', (tool) => {
    const values = {
      ...Object.fromEntries(
        OracleEpcmBlock.subBlocks
          .filter((field) => field.value)
          .map((field) => [field.id, field.value?.({})])
      ),
      operation: tool.id,
    }
    for (const [name, param] of Object.entries(tool.params)) {
      if (param.visibility === 'hidden') continue
      const mapped = blockParam(tool.id, name)
      const activeValues = {
        ...values,
        ...(name === 'ruleName'
          ? { executionType: 'SINGLE_RULE' }
          : name === 'rulesetSeqNumStart' || name === 'rulesetSeqNumEnd'
            ? { executionType: 'RULESET_SUBSET' }
            : {}),
      }
      const fields = OracleEpcmBlock.subBlocks.filter(
        (field) =>
          (field.canonicalParamId ?? field.id) === mapped &&
          evaluateSubBlockCondition(field.condition, activeValues)
      )
      expect(fields.length, `${tool.id}.${name}`).toBeGreaterThan(0)
      if (param.required) {
        expect(
          fields.some(
            (field) =>
              field.required === true ||
              (typeof field.required === 'object' &&
                evaluateSubBlockCondition(field.required, activeValues))
          ),
          `${tool.id}.${name} required`
        ).toBe(true)
      }
    }
  })

  it('uses existing service-account controls and the Oracle oval', () => {
    expect(OracleEpcmBlock.icon).toBe(NetSuiteIcon)
    expect(OracleEpcmBlock.subBlocks.find((field) => field.id === 'credential')).toMatchObject({
      serviceId: 'oracle-epm-enterprise-profitability',
      credentialKind: 'service-account',
    })
    for (const tool of tools) {
      expect(tool.oauth).toMatchObject({
        provider: 'oracle-epm-enterprise-profitability',
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      expect(tool.params.accessToken.visibility).toBe('hidden')
      expect(tool.params.instanceUrl.visibility).toBe('hidden')
      expect(tool.params.oauthCredential.visibility).toBe('user-only')
    }
  })

  it('keeps canonical basic/manual/file pairs aligned', () => {
    const groups = buildCanonicalIndex(OracleEpcmBlock.subBlocks).groupsById
    expect(Object.keys(groups).sort()).toEqual([
      'applicationName',
      'file',
      'jobName',
      'oauthCredential',
      'repositoryFileName',
    ])
    const ids = OracleEpcmBlock.subBlocks.map((field) => field.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [canonical, group] of Object.entries(groups)) {
      expect(ids).not.toContain(canonical)
      expect(group.basicId).toBeTruthy()
      expect(group.advancedIds).toHaveLength(1)
      const pair = OracleEpcmBlock.subBlocks.filter((field) => field.canonicalParamId === canonical)
      expect(pair[0].condition).toEqual(pair[1].condition)
      expect(pair[0].required).toEqual(pair[1].required)
    }
  })

  it('preserves dynamic references during selection and maps canonical fields only', () => {
    expect(
      OracleEpcmBlock.tools.config.params?.({
        operation: `${prefix}list_job_definitions`,
        jobType: '<trigger.jobType>',
      })
    ).toMatchObject({ jobType: '<trigger.jobType>' })
    const params = {
      operation: `${prefix}calculate_model`,
      jobLabel: '<trigger.jobName>',
      applicationName: '<trigger.application>',
      modelName: '<trigger.model>',
      executeCalculations: '<trigger.execute>',
    }
    expect(OracleEpcmBlock.tools.config.tool(params)).toBe(params.operation)
    expect(OracleEpcmBlock.tools.config.params?.(params)).toMatchObject({
      applicationName: params.applicationName,
      modelName: params.modelName,
      jobName: params.jobLabel,
      executeCalculations: params.executeCalculations,
    })
    const exportParams = {
      operation: `${prefix}export_metadata`,
      jobName: '<trigger.savedJob>',
      outputFileName: '<trigger.filename>',
    }
    expect(OracleEpcmBlock.tools.config.params?.(exportParams)).toMatchObject({
      jobName: exportParams.jobName,
      fileName: exportParams.outputFileName,
    })
    expect(
      OracleEpcmBlock.tools.config.params?.({ jobName: 'Direct agent input', cubeName: 'PCM_CLC' })
    ).toEqual({ jobName: 'Direct agent input', cubeName: 'PCM_CLC' })
  })

  it('does not normalize file references in tool selection or trust input scope', () => {
    const params = {
      operation: `${prefix}upload_file`,
      file: '<trigger.file>',
      outputFileName: '<trigger.name>',
    }
    expect(OracleEpcmBlock.tools.config.tool(params)).toBe(params.operation)
    expect(OracleEpcmBlock.tools.config.params?.(params)).toMatchObject({
      file: params.file,
      fileName: params.outputFileName,
    })
    for (const tool of tools) {
      const input = { oauthCredential: 'credential-1', _context: { userId: 'untrusted' } }
      expect(tool.operation.input(input as never)).toEqual({ oauthCredential: 'credential-1' })
    }
  })

  it('declares only outputs produced by the selected operation', () => {
    for (const tool of tools) {
      for (const name of Object.keys(tool.outputs)) {
        const output = OracleEpcmBlock.outputs[name]
        expect(output, `${tool.id}.${name}`).toBeDefined()
        expect(evaluateSubBlockCondition(output.condition, { operation: tool.id })).toBe(true)
      }
    }
  })

  it('supplies a canvas sentence per action and grounded workflows', () => {
    const sentences = OracleEpcmBlock.canvasPresentation?.sentences?.byOperation
    expect(Object.keys(sentences ?? {}).sort()).toEqual(tools.map((tool) => tool.id).sort())
    expect(OracleEpcmBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    expect(OracleEpcmBlockMeta.skills.length).toBeGreaterThanOrEqual(5)
  })
})
