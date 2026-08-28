/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resend: vi.fn(), sendGrid: vi.fn(), smtp: vi.fn() }))
vi.mock('@/lib/internal/resend/operations', () => ({ executeResendSend: mocks.resend }))
vi.mock('@/lib/internal/sendgrid/operations', () => ({ executeSendGridSend: mocks.sendGrid }))
vi.mock('@/lib/internal/smtp/operations', () => ({ executeSmtpSend: mocks.smtp }))

import { executeResendTool } from '@/lib/internal/resend/execute-tool'
import { executeSendGridTool } from '@/lib/internal/sendgrid/execute-tool'
import { executeSmtpTool } from '@/lib/internal/smtp/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(toolId: string, input: unknown, userId = 'user-1') {
  return {
    toolId,
    input,
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId },
    requestId: 'request-1',
  } as InternalToolOperationCall
}

describe('mail submission handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resend.mockResolvedValue({ success: true, data: { id: 'resend-1' } })
    mocks.sendGrid.mockResolvedValue({ success: true, output: { success: true } })
    mocks.smtp.mockResolvedValue({ success: true, messageId: 'smtp-1' })
  })

  it('dispatches each canonical ID to its operation', async () => {
    const resend = await executeResendTool(
      request('resend_send', {
        resendApiKey: 'secret',
        fromAddress: 'from@example.com',
        to: 'to@example.com',
        subject: 'Hello',
        body: 'Hello',
      })
    )
    const sendGrid = await executeSendGridTool(
      request('sendgrid_send_mail', {
        apiKey: 'secret',
        from: 'from@example.com',
        to: 'to@example.com',
      })
    )
    const smtp = await executeSmtpTool(
      request('smtp_send_mail', {
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpUsername: 'user',
        smtpPassword: 'password',
        smtpSecure: 'SSL',
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Hello',
        body: 'Hello',
      })
    )

    expect([resend.status, sendGrid.status, smtp.status]).toEqual([200, 200, 200])
    expect(mocks.resend).toHaveBeenCalledOnce()
    expect(mocks.sendGrid).toHaveBeenCalledOnce()
    expect(mocks.smtp).toHaveBeenCalledOnce()
  })

  it.each([
    ['resend_send', executeResendTool],
    ['sendgrid_send_mail', executeSendGridTool],
    ['smtp_send_mail', executeSmtpTool],
  ])('authenticates %s before parsing', async (toolId, execute) => {
    const response = await execute(request(toolId, null, ''))
    expect(response.status).toBe(401)
    expect(mocks.resend).not.toHaveBeenCalled()
    expect(mocks.sendGrid).not.toHaveBeenCalled()
    expect(mocks.smtp).not.toHaveBeenCalled()
  })

  it('preserves provider-specific validation envelopes', async () => {
    const resend = await executeResendTool(request('resend_send', {}))
    const sendGrid = await executeSendGridTool(request('sendgrid_send_mail', {}))
    const smtp = await executeSmtpTool(request('smtp_send_mail', {}))
    await expect(resend.json()).resolves.toMatchObject({
      success: false,
      message: expect.any(String),
      errors: expect.any(Array),
    })
    await expect(sendGrid.json()).resolves.toMatchObject({
      error: 'Validation error',
      details: expect.any(Array),
    })
    await expect(smtp.json()).resolves.toMatchObject({
      error: 'Validation error',
      details: expect.any(Array),
    })
  })
})
