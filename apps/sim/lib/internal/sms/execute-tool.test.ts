/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSendSms } = vi.hoisted(() => ({ mockSendSms: vi.fn() }))

vi.mock('@/lib/core/config/env', () => ({ env: { TWILIO_PHONE_NUMBER: '+15555550100' } }))
vi.mock('@/lib/messaging/sms/service', () => ({ sendSMS: mockSendSms }))

import { executeSmsTool } from '@/lib/internal/sms/execute-tool'

const context = { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' }

describe('executeSmsTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends validated operation input through the SMS service once', async () => {
    mockSendSms.mockResolvedValue({ success: true, message: 'sent' })

    const response = await executeSmsTool({
      toolId: 'sms_send',
      input: { to: '+15555550101', body: 'hello' },
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(mockSendSms).toHaveBeenCalledWith({
      to: '+15555550101',
      body: 'hello',
      from: '+15555550100',
    })
    expect(mockSendSms).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid input before calling the provider', async () => {
    const response = await executeSmsTool({
      toolId: 'sms_send',
      input: { to: '', body: 'hello' },
      headers: new Headers(),
      context,
      requestId: 'request-1',
    })

    expect(response.status).toBe(400)
    expect(mockSendSms).not.toHaveBeenCalled()
  })
})
