import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import { appendFileAttachmentsToChatCompletionMessages } from '@/providers/azure-openai/utils'
import type { ProviderFileAttachment } from '@/providers/types'

describe('appendFileAttachmentsToChatCompletionMessages', () => {
  it('adds supported file attachments to the latest user message', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Earlier request' },
      { role: 'assistant', content: 'Earlier response' },
      { role: 'user', content: 'Use these attachments' },
    ]
    const fileAttachments: ProviderFileAttachment[] = [
      {
        name: 'brief.pdf',
        type: 'application/pdf',
        base64: 'cGRm',
      },
      {
        name: 'photo.png',
        type: 'image/png',
        base64: 'cG5n',
      },
    ]

    appendFileAttachmentsToChatCompletionMessages(messages, fileAttachments)

    expect(messages[0]).toEqual({ role: 'user', content: 'Earlier request' })
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Earlier response' })
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Use these attachments' },
        {
          type: 'file',
          file: {
            file_data: 'cGRm',
            filename: 'brief.pdf',
          },
        },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,cG5n',
            detail: 'auto',
          },
        },
      ],
    })
  })

  it('adds a user message when there is no existing user message', () => {
    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: 'You are helpful' }]

    appendFileAttachmentsToChatCompletionMessages(messages, [
      {
        name: 'brief.pdf',
        type: 'application/pdf',
        base64: 'cGRm',
      },
    ])

    expect(messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Please use the attached files.' },
          {
            type: 'file',
            file: {
              file_data: 'cGRm',
              filename: 'brief.pdf',
            },
          },
        ],
      },
    ])
  })

  it('leaves messages unchanged when attachments have unsupported MIME types', () => {
    const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: 'Text only' }]

    appendFileAttachmentsToChatCompletionMessages(messages, [
      {
        name: 'spreadsheet.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: 'eGxzeA==',
      },
    ])

    expect(messages).toEqual([{ role: 'user', content: 'Text only' }])
  })
})
