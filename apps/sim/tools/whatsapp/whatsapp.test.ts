/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { WhatsAppBlock } from '@/blocks/blocks/whatsapp'
import { getMediaTool } from '@/tools/whatsapp/get_media'
import { markReadTool } from '@/tools/whatsapp/mark_read'
import { sendInteractiveTool } from '@/tools/whatsapp/send_interactive'
import { sendMediaTool } from '@/tools/whatsapp/send_media'
import { sendMessageTool } from '@/tools/whatsapp/send_message'
import { sendReactionTool } from '@/tools/whatsapp/send_reaction'
import { sendTemplateTool } from '@/tools/whatsapp/send_template'
import { uploadMediaTool } from '@/tools/whatsapp/upload_media'
import {
  buildMediaMessageBody,
  buildMediaUploadUrl,
  buildMediaUrl,
  transformWhatsAppSendResponse,
  whatsappMediaLimitFor,
} from '@/tools/whatsapp/utils'

const auth = { phoneNumberId: ' 15550001111 ', accessToken: ' token ' }

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), init)
}

describe('WhatsApp request URL and headers', () => {
  it('trims the phone number ID into the versioned messages endpoint', () => {
    expect(sendMessageTool.request.url(auth)).toBe(
      'https://graph.facebook.com/v25.0/15550001111/messages'
    )
  })

  it('trims the access token into a Bearer header', () => {
    expect(sendMessageTool.request.headers!(auth)).toEqual({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    })
  })

  it('throws when the phone number ID is missing', () => {
    expect(() => sendMessageTool.request.url({ ...auth, phoneNumberId: '' })).toThrow(
      /Phone Number ID is required/
    )
  })
})

describe('sendMessageTool body', () => {
  const base = { ...auth, phoneNumber: ' +14155552671 ', message: 'hi' }

  it('sends a trimmed recipient and omits preview_url when unset', () => {
    expect(sendMessageTool.request.body!(base)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+14155552671',
      type: 'text',
      text: { body: 'hi' },
    })
  })

  it('includes preview_url only when an explicit boolean is provided', () => {
    expect(sendMessageTool.request.body!({ ...base, previewUrl: true })).toMatchObject({
      text: { body: 'hi', preview_url: true },
    })
    expect(sendMessageTool.request.body!({ ...base, previewUrl: false })).toMatchObject({
      text: { body: 'hi', preview_url: false },
    })
  })
})

describe('sendTemplateTool body', () => {
  const base = { ...auth, phoneNumber: '+14155552671', templateName: ' hello ', languageCode: 'en' }

  it('omits components when none are provided', () => {
    expect(sendTemplateTool.request.body!(base)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+14155552671',
      type: 'template',
      template: { name: 'hello', language: { code: 'en' } },
    })
  })

  it('parses a JSON string of components', () => {
    const components = [{ type: 'body', parameters: [{ type: 'text', text: 'x' }] }]
    expect(
      sendTemplateTool.request.body!({ ...base, components: JSON.stringify(components) })
    ).toMatchObject({ template: { components } })
  })

  it('rejects components that are not an array', () => {
    expect(() =>
      sendTemplateTool.request.body!({ ...base, components: '{"type":"body"}' })
    ).toThrow(/must be a JSON array/)
  })
})

describe('buildMediaMessageBody', () => {
  const base = { phoneNumber: '+14155552671' }

  it('sends a link under a key named after the media type', () => {
    expect(
      buildMediaMessageBody({ ...base, mediaType: 'image', mediaLink: ' https://x/a.png ' })
    ).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+14155552671',
      type: 'image',
      image: { link: 'https://x/a.png' },
    })
  })

  it('rejects an unsupported media type', () => {
    expect(() =>
      buildMediaMessageBody({ ...base, mediaType: 'gif', mediaLink: 'https://x/a.gif' })
    ).toThrow(/Media type must be one of/)
  })

  it('supports stickers, which take no caption', () => {
    const body = buildMediaMessageBody({
      ...base,
      mediaType: 'sticker',
      mediaId: '123',
      caption: 'ignored',
    })

    expect(body).toMatchObject({ type: 'sticker' })
    expect(body.sticker).toEqual({ id: '123' })
  })

  it('requires exactly one media source', () => {
    expect(() => buildMediaMessageBody({ ...base, mediaType: 'image' })).toThrow(
      /a file, a media ID, or a media link is required/
    )
    expect(() =>
      buildMediaMessageBody({
        ...base,
        mediaType: 'image',
        mediaLink: 'https://x/a.png',
        mediaId: '123',
      })
    ).toThrow(/not both/)
  })

  it('drops caption for audio and filename for non-documents', () => {
    const audioBody = buildMediaMessageBody({
      ...base,
      mediaType: 'audio',
      mediaId: '1',
      caption: 'nope',
      filename: 'nope.mp3',
    })
    expect(audioBody.audio).toEqual({ id: '1' })

    const imageBody = buildMediaMessageBody({
      ...base,
      mediaType: 'image',
      mediaId: '1',
      caption: 'shown',
      filename: 'nope.png',
    })
    expect(imageBody.image).toEqual({ id: '1', caption: 'shown' })

    expect(
      buildMediaMessageBody({
        ...base,
        mediaType: 'document',
        mediaId: '1',
        caption: 'report',
        filename: 'q3.pdf',
      })
    ).toMatchObject({ document: { id: '1', caption: 'report', filename: 'q3.pdf' } })
  })
})

describe('sendMediaTool', () => {
  it('routes through the internal route so a file can be uploaded before sending', () => {
    expect(sendMediaTool.request.url).toBe('/api/tools/whatsapp/send-media')
  })

  it('forwards every media source to the route', () => {
    const file = { name: 'a.png', key: 'k', url: 'u', size: 1, type: 'image/png' }
    expect(
      sendMediaTool.request.body!({ ...auth, phoneNumber: '+1', mediaType: 'image', file })
    ).toMatchObject({ file, mediaType: 'image', phoneNumber: '+1' })
  })
})

describe('sendInteractiveTool body', () => {
  const base = { ...auth, phoneNumber: '+14155552671', bodyText: 'Pick one' }
  const buttons = [{ type: 'reply', reply: { id: 'yes', title: 'Yes' } }]
  const sections = [{ title: 'Menu', rows: [{ id: 'r1', title: 'Row 1' }] }]

  it('builds a button message with optional header and footer', () => {
    expect(
      sendInteractiveTool.request.body!({
        ...base,
        buttons,
        headerText: 'Header',
        footerText: 'Footer',
      })
    ).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Pick one' },
        header: { type: 'text', text: 'Header' },
        footer: { text: 'Footer' },
        action: { buttons },
      },
    })
  })

  it('builds a list message from sections and a menu button label', () => {
    expect(
      sendInteractiveTool.request.body!({ ...base, sections, listButtonText: ' Menu ' })
    ).toMatchObject({
      interactive: { type: 'list', action: { button: 'Menu', sections } },
    })
  })

  it('requires a menu button label for lists', () => {
    expect(() => sendInteractiveTool.request.body!({ ...base, sections })).toThrow(
      /listButtonText is required/
    )
  })

  it('requires exactly one of buttons and sections', () => {
    expect(() => sendInteractiveTool.request.body!(base)).toThrow(/either buttons .* or sections/)
    expect(() =>
      sendInteractiveTool.request.body!({ ...base, buttons, sections, listButtonText: 'Menu' })
    ).toThrow(/not both/)
  })

  it('treats an empty array as absent', () => {
    expect(() => sendInteractiveTool.request.body!({ ...base, buttons: [] })).toThrow(
      /either buttons .* or sections/
    )
  })
})

describe('sendReactionTool body', () => {
  const base = { ...auth, phoneNumber: '+14155552671', messageId: ' wamid.abc ' }

  it('trims the target message ID and sends the emoji', () => {
    expect(sendReactionTool.request.body!({ ...base, emoji: '👍' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+14155552671',
      type: 'reaction',
      reaction: { message_id: 'wamid.abc', emoji: '👍' },
    })
  })

  it('sends an empty emoji to remove a reaction', () => {
    expect(sendReactionTool.request.body!(base)).toMatchObject({
      reaction: { message_id: 'wamid.abc', emoji: '' },
    })
  })
})

describe('markReadTool body', () => {
  const base = { ...auth, messageId: ' wamid.abc ' }

  it('omits the typing indicator by default', () => {
    expect(markReadTool.request.body!(base)).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.abc',
    })
  })

  it('adds a text typing indicator when requested', () => {
    expect(markReadTool.request.body!({ ...base, showTypingIndicator: true })).toMatchObject({
      typing_indicator: { type: 'text' },
    })
  })

  it('reports success from the {"success": true} response', async () => {
    const result = await markReadTool.transformResponse!(jsonResponse({ success: true }))
    expect(result.output.success).toBe(true)
  })

  it('surfaces the API error message and code', async () => {
    await expect(
      markReadTool.transformResponse!(
        jsonResponse(
          { error: { message: 'Invalid parameter', code: 100, error_data: { details: 'bad id' } } },
          { status: 400 }
        )
      )
    ).rejects.toThrow('Invalid parameter — bad id (code 100)')
  })
})

describe('WhatsApp media endpoints', () => {
  it('builds the upload endpoint from a trimmed phone number ID', () => {
    expect(buildMediaUploadUrl(' 15550001111 ')).toBe(
      'https://graph.facebook.com/v25.0/15550001111/media'
    )
  })

  it('builds the media metadata endpoint with and without the scoping param', () => {
    expect(buildMediaUrl(' 987654321 ')).toBe('https://graph.facebook.com/v25.0/987654321')
    expect(buildMediaUrl('987654321', '15550001111')).toBe(
      'https://graph.facebook.com/v25.0/987654321?phone_number_id=15550001111'
    )
  })

  it('encodes IDs so a crafted value cannot alter the path', () => {
    expect(buildMediaUrl('../messages')).toBe('https://graph.facebook.com/v25.0/..%2Fmessages')
  })
})

describe('whatsappMediaLimitFor', () => {
  it('applies the documented per-type ceilings', () => {
    expect(whatsappMediaLimitFor('image/jpeg').maxBytes).toBe(5 * 1024 * 1024)
    expect(whatsappMediaLimitFor('video/mp4').maxBytes).toBe(16 * 1024 * 1024)
    expect(whatsappMediaLimitFor('audio/ogg').maxBytes).toBe(16 * 1024 * 1024)
    expect(whatsappMediaLimitFor('application/pdf').maxBytes).toBe(100 * 1024 * 1024)
  })

  it('gives stickers the tighter cap even though they are images', () => {
    expect(whatsappMediaLimitFor('image/webp').maxBytes).toBe(500 * 1024)
    expect(whatsappMediaLimitFor('IMAGE/WEBP').maxBytes).toBe(500 * 1024)
  })

  it('falls back to the document ceiling for unknown types', () => {
    expect(whatsappMediaLimitFor('application/x-thing').maxBytes).toBe(100 * 1024 * 1024)
  })
})

describe('WhatsAppBlock file param mapping', () => {
  const userFile = {
    id: 'f1',
    name: 'invoice.pdf',
    url: 'https://storage/invoice.pdf',
    size: 1024,
    type: 'application/pdf',
    key: 'execution/ws/wf/ex/invoice.pdf',
  }

  function mapParams(params: Record<string, unknown>) {
    return WhatsAppBlock.tools.config!.params!(params) as Record<string, unknown>
  }

  /**
   * The serializer deletes the `uploadFile`/`uploadFileRef` subblock IDs and republishes
   * the value under the `file` canonicalParamId, so the params mapper must read the
   * canonical key. Reading a subblock ID here would silently upload nothing.
   */
  it('maps the canonical file param onto the tool file param', () => {
    expect(mapParams({ operation: 'upload_media', file: userFile }).file).toEqual(userFile)
  })

  it('parses a JSON-stringified file reference from advanced mode', () => {
    expect(mapParams({ operation: 'upload_media', file: JSON.stringify(userFile) }).file).toEqual(
      userFile
    )
  })

  it('unwraps a single-element array so a file reference resolves to one file', () => {
    expect(mapParams({ operation: 'upload_media', file: [userFile] }).file).toEqual(userFile)
  })

  it('omits file entirely when nothing was uploaded', () => {
    expect(mapParams({ operation: 'upload_media' })).not.toHaveProperty('file')
  })

  it('does not leak the UI-only params to the tool', () => {
    const mapped = mapParams({
      operation: 'upload_media',
      file: userFile,
      interactiveType: 'button',
      downloadMediaId: 'should-not-leak',
    })

    expect(mapped).not.toHaveProperty('interactiveType')
    expect(mapped).not.toHaveProperty('downloadMediaId')
  })

  it('maps the download media ID onto the tool mediaId param', () => {
    expect(mapParams({ operation: 'get_media', downloadMediaId: '123' }).mediaId).toBe('123')
  })

  describe('send_media media source', () => {
    /** The canonical pair carries exactly one thing — a file. Upload basic, reference advanced. */
    it('pairs a file upload with a file reference and nothing else', () => {
      const members = WhatsAppBlock.subBlocks.filter(
        (sub) => sub.canonicalParamId === 'mediaSource'
      )

      expect(members.map((sub) => [sub.id, sub.type, sub.mode])).toEqual([
        ['sendMediaFile', 'file-upload', 'basic'],
        ['sendMediaFileRef', 'short-input', 'advanced'],
      ])
    })

    it('resolves either pair member to the tool file param', () => {
      expect(mapParams({ operation: 'send_media', mediaSource: userFile }).file).toEqual(userFile)
      expect(
        mapParams({ operation: 'send_media', mediaSource: JSON.stringify(userFile) }).file
      ).toEqual(userFile)
    })

    /**
     * Media ID and media link are separate concepts, so they stay separate subblocks and pass
     * through untouched. Keeping them out of the pair is also what preserves workflows built
     * before the file upload existed.
     */
    it('passes a media ID or link through without touching the file param', () => {
      const byId = mapParams({ operation: 'send_media', mediaId: '1003383421387256' })
      expect(byId.mediaId).toBe('1003383421387256')
      expect(byId.file).toBeUndefined()

      const byLink = mapParams({ operation: 'send_media', mediaLink: 'https://legacy/a.png' })
      expect(byLink.mediaLink).toBe('https://legacy/a.png')
      expect(byLink.file).toBeUndefined()
    })

    /** None of the three sources is statically required, so no path fails pre-execution validation. */
    it('leaves every media source optional so any one of them can satisfy the send', () => {
      const sourceIds = ['sendMediaFile', 'sendMediaFileRef', 'mediaId', 'mediaLink']
      for (const id of sourceIds) {
        const sub = WhatsAppBlock.subBlocks.find((candidate) => candidate.id === id)
        expect(sub?.required, `${id} must not be required`).toBe(false)
      }
      expect(mapParams({ operation: 'send_media' })).not.toHaveProperty('file')
    })
  })
})

describe('media tool request bodies', () => {
  it('forwards the file and credentials to the upload route', () => {
    const file = { name: 'a.pdf', key: 'k', url: 'u', size: 10, type: 'application/pdf' }
    expect(uploadMediaTool.request.url).toBe('/api/tools/whatsapp/upload-media')
    expect(uploadMediaTool.request.body!({ ...auth, file })).toEqual({
      accessToken: ' token ',
      phoneNumberId: ' 15550001111 ',
      file,
    })
  })

  it('forwards execution context so the download is stored as an execution file', () => {
    const body = getMediaTool.request.body!({
      ...auth,
      mediaId: '123',
      _context: { workspaceId: 'ws', workflowId: 'wf', executionId: 'ex', userId: 'u' },
    })

    expect(body).toEqual({
      accessToken: ' token ',
      phoneNumberId: ' 15550001111 ',
      mediaId: '123',
      workspaceId: 'ws',
      workflowId: 'wf',
      executionId: 'ex',
    })
  })

  it('omits execution context when the tool runs outside an execution', () => {
    expect(getMediaTool.request.body!({ ...auth, mediaId: '123' })).toEqual({
      accessToken: ' token ',
      phoneNumberId: ' 15550001111 ',
      mediaId: '123',
      workspaceId: undefined,
      workflowId: undefined,
      executionId: undefined,
    })
  })

  it('surfaces the route error message', async () => {
    await expect(
      getMediaTool.transformResponse!(jsonResponse({ success: false, error: 'Media not found' }))
    ).rejects.toThrow('Media not found')
  })
})

describe('transformWhatsAppSendResponse', () => {
  it('extracts the message ID, pacing status, and first contact', async () => {
    const result = await transformWhatsAppSendResponse(
      jsonResponse({
        messaging_product: 'whatsapp',
        contacts: [{ input: '+14155552671', wa_id: '14155552671' }],
        messages: [{ id: 'wamid.abc', message_status: 'accepted' }],
      })
    )

    expect(result.output).toEqual({
      success: true,
      messageId: 'wamid.abc',
      messageStatus: 'accepted',
      messagingProduct: 'whatsapp',
      inputPhoneNumber: '+14155552671',
      whatsappUserId: '14155552671',
      contacts: [{ input: '+14155552671', wa_id: '14155552671' }],
    })
  })

  it('tolerates a reaction response that omits message_status', async () => {
    const result = await transformWhatsAppSendResponse(
      jsonResponse({
        messaging_product: 'whatsapp',
        contacts: [{ input: '+14155552671', wa_id: '14155552671' }],
        messages: [{ id: 'wamid.abc' }],
      })
    )

    expect(result.output.messageId).toBe('wamid.abc')
    expect(result.output.messageStatus).toBeUndefined()
  })

  it('nulls out contact fields when WhatsApp returns no contacts', async () => {
    const result = await transformWhatsAppSendResponse(
      jsonResponse({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.abc' }] })
    )

    expect(result.output.inputPhoneNumber).toBeNull()
    expect(result.output.whatsappUserId).toBeNull()
    expect(result.output.contacts).toEqual([])
  })

  it('throws when the response carries no message ID', async () => {
    await expect(
      transformWhatsAppSendResponse(jsonResponse({ messaging_product: 'whatsapp', messages: [] }))
    ).rejects.toThrow(/did not include a message ID/)
  })

  it('falls back to the status code when the error body has no message', async () => {
    await expect(transformWhatsAppSendResponse(jsonResponse({}, { status: 503 }))).rejects.toThrow(
      'WhatsApp API error (503)'
    )
  })
})
