/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { outlookGetAttachmentTool } from '@/tools/outlook/get_attachment'

const PARAMS = {
  accessToken: 'provider-token',
  messageId: 'message-1',
  attachmentId: 'attachment-1',
}

describe('Outlook attachment operation declaration', () => {
  it('downloads through the internal operation while preserving the file-array contract', () => {
    expect('request' in outlookGetAttachmentTool).toBe(false)
    expect(outlookGetAttachmentTool.operation.input(PARAMS)).toEqual(PARAMS)
    expect(outlookGetAttachmentTool.outputs?.attachments.type).toBe('file[]')
    expect(outlookGetAttachmentTool.outputs?.results.type).toBe('object')
  })

  it('projects only attachment identifiers to model input', () => {
    const policy = outlookGetAttachmentTool.operation.modelInput
    if (policy?.mode !== 'project') throw new Error('Expected projected model input')

    expect(policy.select(PARAMS)).toEqual({
      messageId: 'message-1',
      attachmentId: 'attachment-1',
    })
  })
})
