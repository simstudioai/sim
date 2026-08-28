/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const mocks = vi.hoisted(() => ({ materialize: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/internal/mail/attachment-materialization', async () => ({
  MailAttachmentMaterializationError: class extends Error {},
  materializeAuthorizedMailAttachments: mocks.materialize,
}))
vi.mock('@/lib/internal/sendgrid/client', () => ({ sendSendGridMail: mocks.send }))

import { executeSendGridSend } from '@/lib/internal/sendgrid/operations'

const context = { headers: new Headers(), requestId: 'request-1', userId: 'user-1' }

describe('SendGrid operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.send.mockResolvedValue('message-1')
    mocks.materialize.mockResolvedValue([
      { name: 'a.txt', contentType: 'text/plain', buffer: Buffer.from('abc') },
    ])
  })

  it('builds template personalizations and authorized attachments exactly', async () => {
    const attachment = { key: 'workspace/ws-1/a.txt', name: 'a.txt', size: 3 }
    await expect(
      executeSendGridSend(
        {
          apiKey: 'secret',
          from: 'from@example.com',
          fromName: 'From',
          to: 'to@example.com',
          toName: 'To',
          subject: null,
          templateId: 'template-1',
          dynamicTemplateData: '{"name":"Ada"}',
          cc: 'cc@example.com',
          attachments: [attachment],
        },
        context
      )
    ).resolves.toMatchObject({ output: { messageId: 'message-1', to: 'to@example.com' } })
    expect(mocks.materialize).toHaveBeenCalledWith([attachment], context, {
      label: 'Total attachment size',
      maxTotalBytes: 30 * 1024 * 1024,
    })
    expect(mocks.send).toHaveBeenCalledWith(
      'secret',
      expect.objectContaining({
        personalizations: [
          expect.objectContaining({
            to: [{ email: 'to@example.com', name: 'To' }],
            cc: [{ email: 'cc@example.com' }],
            dynamic_template_data: { name: 'Ada' },
          }),
        ],
        template_id: 'template-1',
        attachments: [
          {
            content: 'YWJj',
            filename: 'a.txt',
            type: 'text/plain',
            disposition: 'attachment',
          },
        ],
      }),
      undefined
    )
  })

  it('fails closed on incomplete attachment provenance', async () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    await expect(
      executeSendGridSend(
        {
          apiKey: 'secret',
          from: 'from@example.com',
          to: 'to@example.com',
          [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: false, entries: [] },
        },
        { ...context, headers }
      )
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'Model input provenance is unavailable' },
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
