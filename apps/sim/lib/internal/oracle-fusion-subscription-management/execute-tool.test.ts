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
import { executeOracleFusionSubscriptionTool } from '@/lib/internal/oracle-fusion-subscription-management/execute-tool'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'test-token',
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
}
function call(name: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
  return executeOracleFusionSubscriptionTool({
    toolId: `oracle_fusion_subscription_management_${name}`,
    input: { ...AUTH, ...input },
    headers: new Headers(),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' },
    requestId: 'request-1',
    signal,
  })
}

describe('Subscription Management internal executor', () => {
  beforeEach(() => vi.resetAllMocks())

  it('rejects invalid inputs and unregistered operations before provider requests', async () => {
    expect((await call('create_subscription')).status).toBe(400)
    for (const name of ['constructor', 'update_bill_line', 'list_accounts']) {
      expect((await call(name)).status).toBe(500)
    }
    expect(mocks.json).not.toHaveBeenCalled()
    expect(mocks.empty).not.toHaveBeenCalled()
  })

  it.each([400, 401, 403, 404, 429, 503])(
    'preserves safe provider status %s without mutation retry',
    async (status) => {
      mocks.json.mockRejectedValue(
        new OracleFusionProviderError('Oracle rejected this request', status)
      )
      const response = await call('activate_subscription', { subscriptionNumber: 'SUB-001' })
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Oracle rejected this request',
        retryable: false,
      })
      expect(mocks.json).toHaveBeenCalledTimes(1)
    }
  )

  it('prevents retry of deletes and unexpected write failures through the tool executor', async () => {
    mocks.empty.mockRejectedValue(new Error('private-canary'))
    const response = await call('delete_subscription', { subscriptionNumber: 'SUB-001' })
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ success: false, retryable: false })
    expect(JSON.stringify(body)).not.toContain('private-canary')
  })

  it('turns pre-26C FAILED results into nonretryable business failures', async () => {
    mocks.json.mockResolvedValue({ result: 'FAILED' })
    const response = await call('suspend_product', {
      subscriptionNumber: 'SUB-001',
      subscriptionProductPuid: 'P-001',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, retryable: false })
  })

  it('returns async submission prose without claiming completion or extracting jobs', async () => {
    const result = 'The request was submitted. ESS job 123 is processing.'
    mocks.json.mockResolvedValue({ result, jobId: 'unpublished' })
    const response = await call('close_subscription', { subscriptionNumber: 'SUB-001' })
    expect(await response.json()).toEqual({ success: true, output: { result } })
  })

  it('rejects malformed action responses without retrying the mutation', async () => {
    for (const data of [null, {}, { result: {} }, { result: true }, { result: 42 }]) {
      mocks.json.mockResolvedValue(data)
      const response = await call('activate_subscription', { subscriptionNumber: 'SUB-001' })
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ success: false, retryable: false })
    }
  })

  it('propagates cancellation before and during a lifecycle request', async () => {
    const reason = new DOMException('Cancelled', 'AbortError')
    const controller = new AbortController()
    controller.abort(reason)
    await expect(call('list_subscriptions', {}, controller.signal)).rejects.toBe(reason)
    expect(mocks.json).not.toHaveBeenCalled()
    const pending = new AbortController()
    mocks.json.mockImplementation(async () => {
      pending.abort(reason)
      return { result: 'Successful' }
    })
    await expect(
      call('activate_subscription', { subscriptionNumber: 'SUB-001' }, pending.signal)
    ).rejects.toBe(reason)
    expect(mocks.json.mock.calls[0][2]).toBe(pending.signal)
  })
})
