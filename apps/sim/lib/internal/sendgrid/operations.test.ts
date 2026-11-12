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
    mocks.send.mockResolvedValue('message-1')
    mocks.materialize.mockResolvedValue([
      { name: 'a.txt', contentType: 'text/plain', buffer: Buffer.from('abc') },
    ])
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
