import { describe, expect, it } from 'vitest'
import { buildResponsesInputFromMessages } from '@/providers/openai/utils'
import type { ProviderFileAttachment } from '@/providers/types'

describe('buildResponsesInputFromMessages', () => {
  it('attaches files to the latest user message', () => {
    const fileAttachments: ProviderFileAttachment[] = [
      {
        name: 'brief.pdf',
        type: 'application/pdf',
        base64: 'cGRm',
      },
    ]

    const input = buildResponsesInputFromMessages(
      [
        { role: 'user', content: 'Earlier request' },
        { role: 'assistant', content: 'Earlier response' },
        { role: 'user', content: 'Use this file now' },
      ],
      fileAttachments
    )

    expect(input[0]).toEqual({ role: 'user', content: 'Earlier request' })
    expect(input[1]).toEqual({ role: 'assistant', content: 'Earlier response' })
    expect(input[2]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'Use this file now' },
        {
          type: 'input_file',
          file_data: 'data:application/pdf;base64,cGRm',
          filename: 'brief.pdf',
        },
      ],
    })
  })

  it('ignores files with unsupported MIME types', () => {
    const fileAttachments: ProviderFileAttachment[] = [
      {
        name: 'brief.pdf',
        type: 'application/pdf',
        base64: 'cGRm',
      },
      {
        name: 'archive.bin',
        type: 'application/octet-stream',
        base64: 'YmluYXJ5',
      },
      {
        name: 'unknown',
        type: '',
        base64: 'dW5rbm93bg==',
      },
    ]

    const input = buildResponsesInputFromMessages(
      [{ role: 'user', content: 'Use the supported file only' }],
      fileAttachments
    )

    expect(input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Use the supported file only' },
          {
            type: 'input_file',
            file_data: 'data:application/pdf;base64,cGRm',
            filename: 'brief.pdf',
          },
        ],
      },
    ])
  })

  it('leaves messages unchanged when all file attachments are unsupported', () => {
    const fileAttachments: ProviderFileAttachment[] = [
      {
        name: 'spreadsheet.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: 'eGxzeA==',
      },
    ]

    const input = buildResponsesInputFromMessages(
      [{ role: 'user', content: 'This should stay text-only' }],
      fileAttachments
    )

    expect(input).toEqual([{ role: 'user', content: 'This should stay text-only' }])
  })
})
