/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ json: vi.fn(), empty: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.json,
  requestOracleFusionEmpty: mocks.empty,
}))

import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeOracleFusionSalesTool } from '@/lib/internal/oracle-fusion-sales/execute-tool'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'test-token',
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
}

function call(toolId: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
  return executeOracleFusionSalesTool({
    toolId,
    input: { ...AUTH, ...params },
    headers: new Headers(),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' },
    requestId: 'request-1',
    signal,
  })
}

describe('Oracle Fusion Sales internal handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects invalid required inputs before provider requests', async () => {
    const response = await call('oracle_fusion_sales_create_account')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, retryable: false })
    expect(mocks.json).not.toHaveBeenCalled()
    expect(mocks.empty).not.toHaveBeenCalled()
  })

  it('returns documented action results without asserting business success', async () => {
    mocks.json.mockResolvedValue({ result: 'Failure' })
    const response = await call('oracle_fusion_sales_accept_lead', { leadId: '123' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, output: { result: 'Failure' } })
  })

  it('uses the empty-body contract for deletes', async () => {
    mocks.empty.mockResolvedValue(undefined)
    const response = await call('oracle_fusion_sales_delete_account', { accountNumber: 'A001' })
    expect(await response.json()).toEqual({ success: true, output: { deleted: true } })
    expect(mocks.json).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404, 429, 503])('preserves safe provider status %s', async (status) => {
    mocks.json.mockRejectedValue(
      new OracleFusionProviderError('Oracle Fusion denied this request', status)
    )
    const response = await call('oracle_fusion_sales_accept_lead', { leadId: '123' })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Oracle Fusion denied this request',
      retryable: false,
    })
  })

  it('does not disclose unexpected provider or credential errors', async () => {
    mocks.json.mockRejectedValue(new Error('private-provider-canary'))
    const response = await call('oracle_fusion_sales_accept_lead', { leadId: '123' })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private-provider-canary')
  })

  it('rejects malformed action output', async () => {
    mocks.json.mockResolvedValue({ result: { OptyId: 123 } })
    const response = await call('oracle_fusion_sales_convert_lead', { leadId: '123' })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ success: false })
  })

  it('preserves cancellation before and during provider execution', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Cancelled', 'AbortError')
    controller.abort(reason)
    await expect(call('oracle_fusion_sales_list_accounts', {}, controller.signal)).rejects.toBe(
      reason
    )
    expect(mocks.json).not.toHaveBeenCalled()

    const pending = new AbortController()
    mocks.json.mockImplementation(async () => {
      pending.abort(reason)
      return { result: 'Successful' }
    })
    await expect(
      call('oracle_fusion_sales_accept_lead', { leadId: '123' }, pending.signal)
    ).rejects.toBe(reason)
    expect(mocks.json.mock.calls[0][2]).toBe(pending.signal)
  })

  it('does not dispatch unrelated or inherited object property names', async () => {
    for (const toolId of [
      'oracle_fusion_service_list_accounts',
      'oracle_fusion_sales_constructor',
    ]) {
      expect((await call(toolId)).status).toBe(500)
    }
    expect(mocks.json).not.toHaveBeenCalled()
  })
})
