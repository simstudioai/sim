/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildResponsesInputFromMessages } from '@/providers/openai/utils'

describe('buildResponsesInputFromMessages', () => {
  it('should convert user message files to Responses multipart content', () => {
    const input = buildResponsesInputFromMessages([
      {
        role: 'user',
        content: 'Analyze this image',
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/example.png',
            name: 'example.png',
            url: '/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace',
            size: 128,
            type: 'image/png',
            base64: 'iVBORw0KGgo=',
          },
        ],
      },
    ])

    expect(input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Analyze this image' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,iVBORw0KGgo=',
          },
        ],
      },
    ])
  })
})
