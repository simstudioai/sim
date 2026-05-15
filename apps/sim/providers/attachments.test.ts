/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { UserFile } from '@/executor/types'
import {
  buildAnthropicMessageContent,
  buildBedrockMessageContent,
  buildGeminiMessageParts,
  buildOpenAIMessageContent,
  buildOpenRouterMessageContent,
  formatMessagesForProvider,
  inferAttachmentMimeType,
  prepareProviderAttachments,
} from '@/providers/attachments'

const imageFile: UserFile = {
  id: 'file-1',
  name: 'example.png',
  url: '/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace',
  size: 128,
  type: 'image/png',
  key: 'workspace/ws-1/example.png',
  base64: 'iVBORw0KGgo=',
}

const pdfFile: UserFile = {
  id: 'file-2',
  name: 'example.pdf',
  url: '/api/files/serve/workspace%2Fws-1%2Fexample.pdf?context=workspace',
  size: 256,
  type: 'application/pdf',
  key: 'workspace/ws-1/example.pdf',
  base64: 'cGRm',
}

const markdownFile: UserFile = {
  id: 'file-3',
  name: 'notes.md',
  url: '/api/files/serve/workspace%2Fws-1%2Fnotes.md?context=workspace',
  size: 17,
  type: 'text/markdown',
  key: 'workspace/ws-1/notes.md',
  base64: Buffer.from('# Notes\n\nHello').toString('base64'),
}

describe('provider attachments', () => {
  it('infers MIME type from filename when file type is generic', () => {
    expect(
      inferAttachmentMimeType({
        ...imageFile,
        type: 'application/octet-stream',
      })
    ).toBe('image/png')
  })

  it('formats OpenAI Responses content with text, image, and file parts', () => {
    const content = buildOpenAIMessageContent(
      'Analyze these files',
      [imageFile, pdfFile, markdownFile],
      'openai'
    )

    expect(content).toEqual([
      { type: 'input_text', text: 'Analyze these files' },
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,iVBORw0KGgo=',
        detail: 'auto',
      },
      {
        type: 'input_file',
        filename: 'example.pdf',
        file_data: 'data:application/pdf;base64,cGRm',
      },
      {
        type: 'input_file',
        filename: 'notes.md',
        file_data: `data:text/markdown;base64,${markdownFile.base64}`,
      },
    ])
  })

  it('formats Anthropic content with image, PDF document, and text document blocks', () => {
    const content = buildAnthropicMessageContent(
      'Analyze these files',
      [imageFile, pdfFile, markdownFile],
      'anthropic'
    )

    expect(content).toEqual([
      { type: 'text', text: 'Analyze these files' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgo=',
        },
      },
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: 'cGRm',
        },
        title: 'example.pdf',
      },
      {
        type: 'document',
        source: {
          type: 'text',
          media_type: 'text/plain',
          data: '# Notes\n\nHello',
        },
        title: 'notes.md',
      },
    ])
  })

  it('formats Gemini content with text and inline data parts', () => {
    const parts = buildGeminiMessageParts('Analyze this file', [imageFile, markdownFile], 'google')

    expect(parts).toEqual([
      { text: 'Analyze this file' },
      {
        inlineData: {
          mimeType: 'image/png',
          data: 'iVBORw0KGgo=',
        },
      },
      {
        inlineData: {
          mimeType: 'text/plain',
          data: markdownFile.base64,
        },
      },
    ])
  })

  it('formats Bedrock content with native document blocks', () => {
    const parts = buildBedrockMessageContent('Analyze this file', [markdownFile], 'bedrock')

    expect(parts).toEqual([
      { text: 'Analyze this file' },
      {
        document: {
          format: 'md',
          name: 'notes',
          source: {
            bytes: Buffer.from(markdownFile.base64, 'base64'),
          },
        },
      },
    ])
  })

  it('formats OpenRouter images and PDFs with native multimodal message parts', () => {
    const content = buildOpenRouterMessageContent(
      'Analyze these files',
      [imageFile, pdfFile],
      'openrouter'
    )

    expect(content).toEqual([
      { type: 'text', text: 'Analyze these files' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
      },
      {
        type: 'file',
        file: {
          filename: 'example.pdf',
          file_data: 'data:application/pdf;base64,cGRm',
        },
      },
    ])
  })

  it('formats image-only provider messages and strips file fields', () => {
    const messages = formatMessagesForProvider(
      [{ role: 'user', content: 'Analyze this image', files: [imageFile] }],
      'groq'
    )

    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this image' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
          },
        ],
      },
    ])
  })

  it('fails fast for unsupported MIME types', () => {
    expect(() =>
      prepareProviderAttachments(
        [
          {
            ...imageFile,
            name: 'archive.zip',
            type: 'application/zip',
          },
        ],
        'openai'
      )
    ).toThrow('application/zip')
  })

  it('sniffs image bytes and corrects a wrong declared image MIME type', () => {
    const content = buildAnthropicMessageContent(
      'Analyze this image',
      [
        {
          ...imageFile,
          name: 'wrong.ico',
          type: 'image/x-icon',
        },
      ],
      'anthropic'
    )

    expect(content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    })
  })

  it('rejects image attachments when the bytes are not a supported image format', () => {
    expect(() =>
      prepareProviderAttachments(
        [
          {
            ...imageFile,
            name: 'not-an-image.png',
            base64: Buffer.from('not an image').toString('base64'),
          },
        ],
        'anthropic'
      )
    ).toThrow('not a supported model image format')
  })

  it('rejects documents for image-only providers', () => {
    expect(() =>
      formatMessagesForProvider(
        [{ role: 'user', content: 'Analyze this file', files: [pdfFile] }],
        'groq'
      )
    ).toThrow('Supported attachments: images')
  })

  it('rejects providers without file attachment support', () => {
    expect(() =>
      formatMessagesForProvider(
        [{ role: 'user', content: 'Analyze this file', files: [imageFile] }],
        'deepseek'
      )
    ).toThrow('not supported')
  })
})
