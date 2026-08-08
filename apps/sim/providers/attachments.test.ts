/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { LARGE_VALUE_THRESHOLD_BYTES } from '@/lib/execution/payloads/large-value-ref'
import type { UserFile } from '@/executor/types'
import {
  buildAnthropicMessageContent,
  buildBedrockMessageContent,
  buildGeminiMessageParts,
  buildOpenAICompatibleChatContent,
  buildOpenAIMessageContent,
  buildOpenRouterMessageContent,
  formatAttachmentSizes,
  formatMessagesForProvider,
  getProviderAttachmentMaxBytes,
  getProviderFileStrategy,
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
  inferAttachmentMimeType,
  isProviderAttachmentFilenameModelBound,
  LARGE_FILE_PATH_THRESHOLD_BYTES,
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

  it('infers MIME type from filename when file type is a generated-doc source marker', () => {
    expect(
      inferAttachmentMimeType({
        ...pdfFile,
        type: 'text/x-python-pdf',
      })
    ).toBe('application/pdf')
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

  it('keeps image filenames raw for MIME inference and does not project unsent names', () => {
    const source: UserFile = {
      ...imageFile,
      name: 'secret-image.png',
      type: 'application/octet-stream',
    }
    const projectFilename = vi.fn(() => '{{IMAGE_NAME}}.png')

    const content = buildOpenAIMessageContent('Analyze', [source], 'openai', projectFilename)

    expect(projectFilename).not.toHaveBeenCalled()
    expect(source.name).toBe('secret-image.png')
    expect(content).toEqual([
      { type: 'input_text', text: 'Analyze' },
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,iVBORw0KGgo=',
        detail: 'auto',
      },
    ])
  })

  it('treats an image filename as provider-bound only when its upload path is active', () => {
    const largeImage = { ...imageFile, size: LARGE_FILE_PATH_THRESHOLD_BYTES + 1 }

    expect(isProviderAttachmentFilenameModelBound(largeImage, 'openai')).toBe(false)
    expect(
      isProviderAttachmentFilenameModelBound(largeImage, 'openai', {
        largeFilePathAvailable: true,
      })
    ).toBe(true)
  })

  it('projects a document filename only after raw MIME and extension inference', () => {
    const source: UserFile = {
      ...pdfFile,
      name: 'report.pdf',
      type: 'application/octet-stream',
    }
    const projectFilename = vi.fn(() => '{{FILE_NAME}}.pdf')

    const content = buildOpenAIMessageContent('Analyze', [source], 'openai', projectFilename)

    expect(projectFilename).toHaveBeenCalledOnce()
    expect(projectFilename).toHaveBeenCalledWith('report.pdf', 'pdf')
    expect(source.name).toBe('report.pdf')
    expect(content).toEqual([
      { type: 'input_text', text: 'Analyze' },
      {
        type: 'input_file',
        filename: '{{FILE_NAME}}.pdf',
        file_data: 'data:application/pdf;base64,cGRm',
      },
    ])
  })

  it('uses a neutral Bedrock document name when projection changes the original', () => {
    const content = buildBedrockMessageContent(
      'Analyze',
      [{ ...markdownFile, name: 'TOKEN.md' }],
      'bedrock',
      () => '{{TOKEN}}.md'
    )

    expect(content).toEqual([
      { text: 'Analyze' },
      {
        document: {
          format: 'md',
          name: 'Document',
          source: { bytes: Buffer.from(markdownFile.base64, 'base64') },
        },
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

describe('attachment limit formatting', () => {
  /**
   * Guards both directions of the unit bug: dividing every ceiling by 1024² reported OpenAI's
   * decimal 50 MB as "48MB", and dividing every ceiling by 10⁶ reported Anthropic's 50 MiB as
   * "52MB". Each vendor's number must come back as that vendor publishes it.
   */
  it('reports each ceiling in the unit its vendor publishes', () => {
    expect(formatAttachmentSizes(0, 50_000_000).limit).toBe('50')
    expect(formatAttachmentSizes(0, 50 * 1024 * 1024).limit).toBe('50')
    expect(formatAttachmentSizes(0, 20 * 1024 * 1024).limit).toBe('20')
    expect(formatAttachmentSizes(0, 25 * 1024 * 1024).limit).toBe('25')
    expect(formatAttachmentSizes(0, 10 * 1024 * 1024).limit).toBe('10')
  })

  /**
   * Exercises `limit + 1` for every ceiling in the registry, which is the only input that can
   * expose this: rounding both figures to the nearest hundredth rendered a file one byte over a
   * 20 MiB cap as "20.00MB exceeds the 20MB limit". The previous version of this test asserted
   * a file 0.03MB over and an openai file *under* the limit, so it passed while that was live.
   */
  it('never renders an over-limit file as equal to the limit', () => {
    const ceilings = [
      50 * 1024 * 1024,
      25 * 1024 * 1024,
      20 * 1024 * 1024,
      10 * 1024 * 1024,
      6 * 1024 * 1024,
      50_000_000,
    ]
    for (const limit of ceilings) {
      const justOver = formatAttachmentSizes(limit + 1, limit)
      expect(justOver.size).not.toBe(justOver.limit)
    }

    /**
     * Every ceiling above divides to an exact integer, so floor/round/ceil are indistinguishable
     * on them — only a ceiling with a fractional remainder pins the limit-side rounding.
     */
    const fractional = formatAttachmentSizes(12_345_679, 12_345_678)
    expect(fractional.size).not.toBe(fractional.limit)
  })

  it('keeps a comfortably over-limit size readable', () => {
    const groq = formatAttachmentSizes(21_000_000, 20 * 1024 * 1024)
    expect(groq.limit).toBe('20')
    expect(groq.size).toBe('20.03')
  })
})

describe('provider large-file capability', () => {
  /**
   * Guards the regression where every 6-10 MB attachment died with "Execution memory limit
   * exceeded": past this size the base64 copy no longer fits the payload store, so an upload
   * has to take over wherever one is reachable.
   */
  it('starts preferring an upload before base64 outgrows the payload store', () => {
    const encodedBytes = Math.ceil(LARGE_FILE_PATH_THRESHOLD_BYTES / 3) * 4
    expect(encodedBytes).toBeLessThanOrEqual(LARGE_VALUE_THRESHOLD_BYTES)
    expect(LARGE_FILE_PATH_THRESHOLD_BYTES).toBeLessThan(INLINE_ATTACHMENT_THRESHOLD_BYTES)
  })

  /**
   * A `remote-url` provider only fetches images and PDFs, so it must not take over from base64
   * early — text documents in the 6-10 MB band inline fine today and would start failing.
   */
  /** A size we cannot read must still reach the uploader, which enforces the ceiling itself. */
  it('routes an unknown-size file to a files-api upload rather than stranding it', () => {
    const unknown = { size: 0, type: 'text/csv' }
    expect(shouldUseLargeFilePath(unknown, 'openai')).toBe(true)
    expect(shouldUseLargeFilePath(unknown, 'anthropic')).toBe(false)
    expect(shouldUseLargeFilePath({ size: Number.NaN, type: 'text/csv' }, 'openai')).toBe(true)
  })

  it('crosses over to an upload at different sizes for files-api and remote-url', () => {
    const midBand = { size: LARGE_FILE_PATH_THRESHOLD_BYTES + 1, type: 'text/plain' }
    expect(shouldUseLargeFilePath(midBand, 'openai')).toBe(true)
    expect(shouldUseLargeFilePath(midBand, 'anthropic')).toBe(false)

    const aboveInline = { size: INLINE_ATTACHMENT_THRESHOLD_BYTES + 1, type: 'application/pdf' }
    expect(shouldUseLargeFilePath(aboveInline, 'anthropic')).toBe(true)
  })

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
    const large = { ...imageFile, size: LARGE_FILE_PATH_THRESHOLD_BYTES + 1 }
    expect(shouldUseLargeFilePath(small, 'openai')).toBe(false)
    expect(shouldUseLargeFilePath(large, 'openai')).toBe(true)
    expect(shouldUseLargeFilePath(large, 'bedrock')).toBe(false)
  })

  it('does not expose generated source through a remote-url large-file path', () => {
    const generated = {
      ...pdfFile,
      size: LARGE_FILE_PATH_THRESHOLD_BYTES + 1,
      type: 'text/x-python-pdf',
    }
    expect(shouldUseLargeFilePath(generated, 'openai')).toBe(true)
    expect(shouldUseLargeFilePath(generated, 'anthropic')).toBe(false)
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
