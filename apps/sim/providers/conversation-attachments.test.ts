import { tokenizationAccurateMock } from '@sim/testing/mocks/tokenization-accurate.mock'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import type { UserFile } from '@/executor/types'
import {
  conversationAttachmentTokenSurcharge,
  conversationAttachmentTokensByReference,
} from '@/providers/conversation-attachments'

vi.mock('@/lib/tokenization/accurate', () => tokenizationAccurateMock)

const file: UserFile = {
  id: 'file',
  key: 'file',
  url: 'https://files.test/file',
  name: 'note.pdf',
  type: 'application/pdf',
  size: 900,
  providerFileId: 'provider-file',
  providerFileUri: 'provider://file',
  remoteUrl: 'https://signed.test/file',
}

const fixtures: Array<{ protocol: ConversationProtocol; item: unknown }> = [
  {
    protocol: 'responses',
    item: { role: 'user', content: [{ type: 'input_file', file_id: 'provider-file' }] },
  },
  {
    protocol: 'chat-completions',
    item: {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://signed.test/file' } }],
    },
  },
  {
    protocol: 'anthropic',
    item: {
      role: 'user',
      content: [{ type: 'document', source: { type: 'url', url: 'https://signed.test/file' } }],
    },
  },
  {
    protocol: 'gemini',
    item: { role: 'user', parts: [{ fileData: { fileUri: 'provider://file' } }] },
  },
  {
    protocol: 'bedrock',
    item: {
      role: 'user',
      content: [{ document: { source: { s3Location: { uri: 'https://files.test/file' } } } }],
    },
  },
]

describe('native attachment context accounting', () => {
  it.each(fixtures)(
    'counts only sent $protocol attachments and charges each occurrence once',
    ({ protocol, item }) => {
      const references = conversationAttachmentTokensByReference([file, file])
      expect(conversationAttachmentTokenSurcharge([], protocol, 'model', references)).toBe(0)
      expect(conversationAttachmentTokenSurcharge([item], protocol, 'model', references)).toBe(300)
      expect(
        conversationAttachmentTokenSurcharge([item, item], protocol, 'model', references)
      ).toBe(600)
    }
  )

  it('does not double-charge inline data already counted in the native JSON', () => {
    expect(
      conversationAttachmentTokenSurcharge(
        [
          {
            role: 'user',
            parts: [{ inlineData: { mimeType: 'application/pdf', data: 'abcdef'.repeat(100) } }],
          },
        ],
        'gemini',
        'model',
        conversationAttachmentTokensByReference([file])
      )
    ).toBe(0)
  })

  it('counts provider-native attachments nested inside a tool result without interpreting tool JSON as attachments', () => {
    const result = {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call',
          content: [
            { type: 'image', source: { type: 'url', url: 'https://signed.test/file' } },
            { type: 'text', text: JSON.stringify({ file_id: 'other-provider-file' }) },
          ],
        },
      ],
    }
    expect(
      conversationAttachmentTokenSurcharge(
        [result],
        'anthropic',
        'model',
        conversationAttachmentTokensByReference([file])
      )
    ).toBe(300)
  })
})
