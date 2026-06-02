import type { LinqSendVoiceMemoParams, LinqSendVoiceMemoResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqSendVoiceMemoTool: ToolConfig<LinqSendVoiceMemoParams, LinqSendVoiceMemoResult> = {
  id: 'linq_send_voice_memo',
  name: 'Send Voice Memo',
  description: 'Send a voice memo to a chat from a URL or a pre-uploaded attachment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the chat',
    },
    voiceMemoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Publicly accessible HTTPS URL of the audio file (MP3, M4A, AAC, CAF, WAV, AIFF, AMR)',
    },
    attachmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of a pre-uploaded audio attachment (use instead of voiceMemoUrl)',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}/voicememo`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      if (!params.attachmentId && !params.voiceMemoUrl) {
        throw new Error('Provide either a voice memo URL or a pre-uploaded attachment ID')
      }
      const body: Record<string, unknown> = {}
      if (params.attachmentId) body.attachment_id = params.attachmentId
      else if (params.voiceMemoUrl) body.voice_memo_url = params.voiceMemoUrl
      return body
    },
  },

  transformResponse: async (response): Promise<LinqSendVoiceMemoResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to send voice memo'),
        output: { id: '', status: null, from: null, to: [], service: null, voiceMemo: null },
      }
    }

    const memo = data.voice_memo ?? {}
    return {
      success: true,
      output: {
        id: memo.id ?? '',
        status: memo.status ?? null,
        from: memo.from ?? null,
        to: memo.to ?? [],
        service: memo.service ?? null,
        voiceMemo: memo.voice_memo ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the sent voice memo message' },
    status: { type: 'string', description: 'Delivery status', optional: true },
    from: { type: 'string', description: 'Sender handle', optional: true },
    to: { type: 'json', description: 'Recipient handles' },
    service: {
      type: 'string',
      description: 'Delivery service (iMessage, SMS, RCS)',
      optional: true,
    },
    voiceMemo: {
      type: 'json',
      description: 'Audio file metadata (id, filename, mime_type, size_bytes, url, duration_ms)',
      optional: true,
    },
  },
}
