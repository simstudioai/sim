/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resendSendTool } from '@/tools/resend/send'
import { sendGridSendMailTool } from '@/tools/sendgrid/send_mail'
import { smtpSendMailTool } from '@/tools/smtp/send_mail'

describe('mail submission operation declarations', () => {
  it.each([resendSendTool, sendGridSendMailTool, smtpSendMailTool])(
    '$id has operation input without HTTP metadata',
    (tool) => {
      expect(tool.operation.input).toBeTypeOf('function')
      expect('request' in tool).toBe(false)
    }
  )

  it('preserves SendGrid attachment private provenance selection', () => {
    const modelInput = sendGridSendMailTool.operation.modelInput
    if (modelInput?.mode !== 'private-provenance') {
      throw new Error('SendGrid attachment provenance is missing')
    }
    expect(
      modelInput.inputPaths({
        apiKey: 'secret',
        from: 'from@example.com',
        to: 'to@example.com',
        attachments: 'data:text/plain;base64,{{PRIVATE_FILE}}',
      })
    ).toEqual([['attachments']])
  })
})
