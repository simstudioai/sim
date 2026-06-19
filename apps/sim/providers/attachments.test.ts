/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { UserFile } from '@/executor/types'
import {
  buildAnthropicMessageContent,
  buildBedrockMessageContent,
  buildGeminiMessageParts,
  buildOpenAICompatibleChatContent,
  buildOpenAIMessageContent,
  buildOpenRouterMessageContent,
  formatMessagesForProvider,
  getProviderAttachmentMaxBytes,
  getProviderFileStrategy,
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
  inferAttachmentMimeType,
  prepareProviderAttachments,
  shouldUseLargeFilePath,
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

describe('provider large-file capability', () => {
  it('reports per-provider strategy and ceiling, defaulting others to inline', () => {
    expect(getProviderFileStrategy('openai')).toBe('files-api')
    expect(getProviderFileStrategy('google')).toBe('files-api')
    expect(getProviderFileStrategy('anthropic')).toBe('remote-url')
    expect(getProviderFileStrategy('groq')).toBe('remote-url')
    expect(getProviderFileStrategy('bedrock')).toBe('inline')
    expect(getProviderFileStrategy('azure-openai')).toBe('inline')
    expect(getProviderFileStrategy('vertex')).toBe('inline')

    expect(getProviderAttachmentMaxBytes('openai')).toBeGreaterThan(
      INLINE_ATTACHMENT_THRESHOLD_BYTES
    )
    expect(getProviderAttachmentMaxBytes('bedrock')).toBe(INLINE_ATTACHMENT_THRESHOLD_BYTES)
    expect(getProviderAttachmentMaxBytes('azure-openai')).toBe(INLINE_ATTACHMENT_THRESHOLD_BYTES)
  })

  it('routes only oversized files on capable providers to the large-file path', () => {
    const small = { ...imageFile, size: 1024 }
    const large = { ...imageFile, size: INLINE_ATTACHMENT_THRESHOLD_BYTES + 1 }
    expect(shouldUseLargeFilePath(small, 'openai')).toBe(false)
    expect(shouldUseLargeFilePath(large, 'openai')).toBe(true)
    expect(shouldUseLargeFilePath(large, 'bedrock')).toBe(false)
  })

  it('references uploaded OpenAI files by file_id instead of inlining base64', () => {
    const content = buildOpenAIMessageContent(
      'Analyze',
      [
        { ...imageFile, base64: undefined, providerFileId: 'file-img' },
        { ...pdfFile, base64: undefined, providerFileId: 'file-doc' },
      ],
      'openai'
    )
    expect(content).toEqual([
      { type: 'input_text', text: 'Analyze' },
      { type: 'input_image', file_id: 'file-img', detail: 'auto' },
      { type: 'input_file', file_id: 'file-doc' },
    ])
  })

  it('references large Anthropic files via url content-block sources', () => {
    const content = buildAnthropicMessageContent(
      'Analyze',
      [
        { ...imageFile, base64: undefined, remoteUrl: 'https://signed/img.png' },
        { ...pdfFile, base64: undefined, remoteUrl: 'https://signed/doc.pdf' },
      ],
      'anthropic'
    )
    expect(content).toEqual([
      { type: 'text', text: 'Analyze' },
      { type: 'image', source: { type: 'url', url: 'https://signed/img.png' } },
      {
        type: 'document',
        source: { type: 'url', url: 'https://signed/doc.pdf' },
        title: 'example.pdf',
      },
    ])
  })

  it('references uploaded Gemini files via fileData uri', () => {
    const parts = buildGeminiMessageParts(
      'Analyze',
      [{ ...imageFile, base64: undefined, providerFileUri: 'https://files/abc' }],
      'google'
    )
    expect(parts).toEqual([
      { text: 'Analyze' },
      { fileData: { fileUri: 'https://files/abc', mimeType: 'image/png' } },
    ])
  })

  it('passes a remote url to OpenAI-compatible providers instead of a data url', () => {
    const content = buildOpenAICompatibleChatContent(
      'Analyze',
      [{ ...imageFile, base64: undefined, remoteUrl: 'https://signed/img.png' }],
      'groq'
    )
    expect(content).toEqual([
      { type: 'text', text: 'Analyze' },
      { type: 'image_url', image_url: { url: 'https://signed/img.png' } },
    ])
  })

  it('rejects oversized non-PDF text documents on Anthropic (url source supports PDFs/images only)', () => {
    expect(() =>
      buildAnthropicMessageContent(
        'Analyze',
        [
          {
            ...markdownFile,
            type: 'text/csv',
            name: 'data.csv',
            base64: undefined,
            remoteUrl: 'https://signed/data.csv',
          },
        ],
        'anthropic'
      )
    ).toThrow('Only PDFs and images are supported')
  })

  it('references large Anthropic PDFs via a url document source', () => {
    const content = buildAnthropicMessageContent(
      'Analyze',
      [{ ...pdfFile, base64: undefined, remoteUrl: 'https://signed/doc.pdf' }],
      'anthropic'
    )
    expect(content).toEqual([
      { type: 'text', text: 'Analyze' },
      {
        type: 'document',
        source: { type: 'url', url: 'https://signed/doc.pdf' },
        title: 'example.pdf',
      },
    ])
  })

  it('rejects files above the provider ceiling', () => {
    const huge = {
      ...imageFile,
      size: getProviderAttachmentMaxBytes('openai') + 1,
      base64: undefined,
      providerFileId: 'file-img',
    }
    expect(() => buildOpenAIMessageContent('Analyze', [huge], 'openai')).toThrow('exceeds the')
  })
})
