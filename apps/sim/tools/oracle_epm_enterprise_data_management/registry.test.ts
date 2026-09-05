/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))

import { executeOracleEpmEdmTool } from '@/lib/internal/oracle-epm-enterprise-data-management/execute-tool'
import { isInternalToolOperationRegistered } from '@/lib/internal/tool-operations/registry.server'
import { OracleEpmEnterpriseDataManagementBlock } from '@/blocks/blocks/oracle_epm_enterprise_data_management'
import * as edmTools from '@/tools/oracle_epm_enterprise_data_management'
import { oracleEpmEdmQueryRequestsTool } from '@/tools/oracle_epm_enterprise_data_management/query_requests'
import { oracleEpmEdmTransitionRequestTool } from '@/tools/oracle_epm_enterprise_data_management/transition_request'
import type { OracleEpmEdmTransitionRequestParams } from '@/tools/oracle_epm_enterprise_data_management/types'
import { hasToolId } from '@/tools/tool-ids'

const block = OracleEpmEnterpriseDataManagementBlock
const id = '11111111-1111-4111-8111-111111111111'
describe('EDM registered block-to-tool execution', () => {
  it('requires and exposes only the node-scope identifier needed for the chosen query', async () => {
    const parent = block.subBlocks.find((field) => field.id === 'parentNodeId')!
    const request = block.subBlocks.find((field) => field.id === 'requestSelector')!
    const childValues = { operation: 'oracle_epm_edm_list_nodes', scope: 'children' }
    const requestValues = { operation: 'oracle_epm_edm_list_nodes', scope: 'request' }
    expect(evaluateSubBlockCondition(parent.condition, childValues)).toBe(true)
    expect(parent.required).toBe(true)
    expect(parent.mode).not.toBe('advanced')
    expect(evaluateSubBlockCondition(parent.condition, requestValues)).toBe(false)
    expect(evaluateSubBlockCondition(request.condition, childValues)).toBe(false)
    expect(evaluateSubBlockCondition(request.condition, requestValues)).toBe(true)
    if (typeof request.required !== 'function')
      throw new Error('Expected scope-dependent requirement')
    expect(evaluateSubBlockCondition(request.required(requestValues), requestValues)).toBe(true)
    const params = await block.tools.config!.params!({
      ...requestValues,
      oauthCredential: 'credential',
      viewId: id,
      viewpointId: id,
      parentNodeId: id,
      requestId: id,
    })
    expect(params.requestId).toBe(id)
    expect(params.parentNodeId).toBeUndefined()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })
  it('makes every shipped operation executable without registering the gated search stub', () => {
    const tools = Object.values(edmTools)
    expect(tools).toHaveLength(30)
    expect(new Set(block.tools.access)).toEqual(new Set(tools.map((tool) => tool.id)))
    for (const tool of tools) {
      expect(hasToolId(tool.id), tool.id).toBe(true)
      expect(isInternalToolOperationRegistered(tool.id), tool.id).toBe(true)
      expect(tool.oauth).toMatchObject({
        provider: 'oracle-epm-enterprise-data-management',
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
    }
    expect(hasToolId('oracle_epm_edm_search_nodes')).toBe(false)
  })
  it('converts a block request-number filter and query-priority choice through the actual tool and handler', async () => {
    const params = await block.tools.config!.params!({
      operation: 'oracle_epm_edm_query_requests',
      oauthCredential: 'credential',
      requestNumber: '123',
      queryPriority: 'High',
      expandWorkflow: 'false',
      importOption: 'ResetDimension',
    })
    const input = oracleEpmEdmQueryRequestsTool.operation.input({
      ...params,
      oauthCredential: 'credential',
    })
    mocks.fetch.mockResolvedValue(Response.json({ items: [] }))
    const response = await executeOracleEpmEdmTool({
      toolId: oracleEpmEdmQueryRequestsTool.id,
      input: { ...input, accessToken: 'dTpw', instanceUrl: 'https://edm.example.com' },
      headers: new Headers(),
      context: { workflowId: id },
      requestId: 'query',
    })
    expect(await response.json()).toMatchObject({ success: true })
    const query = new URL(mocks.fetch.mock.calls[0][0]).searchParams
    expect(Object.fromEntries(query)).toEqual({
      lastDays: '30',
      requestNumber: '123',
      priority: 'High',
    })
    expect(input).not.toHaveProperty('importOption')
  })
  it('preserves false transition and wait controls all the way to the provider write', async () => {
    const params = await block.tools.config!.params!({
      operation: 'oracle_epm_edm_transition_request',
      oauthCredential: 'credential',
      requestId: id,
      action: 'SUBMIT',
      transitionWithWarning: 'false',
      waitForCompletion: 'false',
      maxWaitSeconds: '60',
    })
    const input = oracleEpmEdmTransitionRequestTool.operation.input(
      params as OracleEpmEdmTransitionRequestParams
    )
    mocks.fetch.mockResolvedValue(
      Response.json({
        links: [{ rel: 'results', href: `https://edm.example.com/epm/rest/v1/jobRuns/${id}` }],
      })
    )
    const response = await executeOracleEpmEdmTool({
      toolId: oracleEpmEdmTransitionRequestTool.id,
      input: { ...input, accessToken: 'dTpw', instanceUrl: 'https://edm.example.com' },
      headers: new Headers(),
      context: { workflowId: id },
      requestId: 'transition',
    })
    expect(await response.json()).toMatchObject({
      success: true,
      output: { jobId: id, completed: false },
    })
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toEqual({
      action: 'SUBMIT',
      transitionWithWarning: false,
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('excludes application picker context when a specific viewpoint dimension filter is selected', async () => {
    const params = await block.tools.config!.params!({
      operation: 'oracle_epm_edm_list_viewpoints',
      oauthCredential: 'credential',
      viewId: id,
      applicationId: id,
      dimensionId: id,
    })
    expect(params).toMatchObject({ viewId: id, dimensionId: id })
    expect(params.applicationId).toBeUndefined()
  })
  it('rejects malformed JSON and numbers before dispatch rather than coercing them', async () => {
    expect(() =>
      block.tools.config!.params!({
        operation: 'oracle_epm_edm_generate_request_attachment',
        items: '{invalid',
      })
    ).toThrow('valid JSON')
    expect(() =>
      block.tools.config!.params!({
        operation: 'oracle_epm_edm_query_requests',
        requestNumber: '12x',
      })
    ).toThrow()
  })
})
