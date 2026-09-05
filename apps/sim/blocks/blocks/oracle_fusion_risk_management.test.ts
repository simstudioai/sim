/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { selectorManifest } from '@/lib/selectors/manifest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import {
  OracleFusionRiskManagementBlock,
  OracleFusionRiskManagementBlockMeta,
} from '@/blocks/blocks/oracle_fusion_risk_management'
import * as riskTools from '@/tools/oracle_fusion_risk_management'

const block = OracleFusionRiskManagementBlock

describe('Risk Management block contracts', () => {
  it('exposes every action and required input in both input modes', () => {
    const tools = Object.values(riskTools)
    expect([...block.tools.access].sort()).toEqual(tools.map((tool) => tool.id).sort())
    expect(new Set(block.subBlocks.map((field) => field.id)).size).toBe(block.subBlocks.length)
    for (const tool of tools) {
      const values = { operation: tool.id }
      expect(block.tools.config.tool(values)).toBe(tool.id)
      for (const [param, config] of Object.entries(tool.params)) {
        if (!config.required || config.visibility === 'hidden') continue
        for (const mode of ['basic', 'advanced']) {
          const fields = block.subBlocks.filter(
            (field) =>
              (field.canonicalParamId ?? field.id) === param &&
              (!field.mode || field.mode === mode) &&
              evaluateSubBlockCondition(field.condition, values)
          )
          expect(fields.length, `${tool.id}: ${param} in ${mode}`).toBeGreaterThan(0)
          expect(fields.every((field) => field.required === true)).toBe(true)
        }
      }
      for (const output of Object.keys(tool.outputs ?? {}))
        expect(block.outputs).toHaveProperty(output)
    }
    expect(OracleFusionRiskManagementBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
  })

  it('preserves dynamic references during tool selection and exact IDs during mapping', () => {
    const params = {
      operation: 'oracle_fusion_risk_management_get_process',
      processId: '<previous.record.ProcessId>',
      limit: '<previous.limit>',
    }
    expect(block.tools.config.tool(params)).toBe(params.operation)
    expect(params.processId).toBe('<previous.record.ProcessId>')
    const mapped = block.tools.config.params!({ ...params, processId: '9007199254740993' })
    expect(mapped).toEqual({ processId: '9007199254740993' })
    expect(
      block.tools.config.params!({
        operation: 'oracle_fusion_risk_management_list_processes',
        limit: '25',
        offset: '0',
        totalResults: 'false',
      })
    ).toEqual({ limit: 25, offset: 0, totalResults: false })
  })

  it('binds selectors to the shared service and credential context', () => {
    for (const field of block.subBlocks) {
      if (!field.selectorKey) continue
      const manifest = selectorManifest[field.selectorKey]
      expect(manifest.classification).toBe('provider-server')
      expect(manifest.listMode).toBe('paginated')
      expect(manifest.context.allowed).toEqual(['oauthCredential'])
      expect(field.dependsOn).toEqual(['oauthCredential'])
      expect(field.serviceId).toBe('oracle_fusion_risk_management')
    }
  })
})
