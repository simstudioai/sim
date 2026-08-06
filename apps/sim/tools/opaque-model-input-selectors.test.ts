/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { a2aSendMessageTool } from '@/tools/a2a/send_message'
import { runTaskTool as browserUseRunTaskTool } from '@/tools/browser_use/run_task'
import { contextDevExtractTool } from '@/tools/context_dev/extract'
import { contextDevExtractProductTool } from '@/tools/context_dev/extract_product'
import { contextDevExtractProductsTool } from '@/tools/context_dev/extract_products'
import { addFollowupTool, addFollowupV2Tool } from '@/tools/cursor/add_followup'
import { launchAgentTool, launchAgentV2Tool } from '@/tools/cursor/launch_agent'
import { elevenLabsAudioIsolationTool } from '@/tools/elevenlabs/audio-isolation'
import { elevenLabsSpeechToSpeechTool } from '@/tools/elevenlabs/speech-to-speech'
import { findSimilarLinksTool as exaFindSimilarLinksTool } from '@/tools/exa/find_similar_links'
import { getContentsTool as exaGetContentsTool } from '@/tools/exa/get_contents'
import { extendParserTool, extendParserV2Tool } from '@/tools/extend/parser'
import { agentTool as firecrawlAgentTool } from '@/tools/firecrawl/agent'
import { batchScrapeTool as firecrawlBatchScrapeTool } from '@/tools/firecrawl/batch-scrape'
import { crawlTool as firecrawlCrawlTool } from '@/tools/firecrawl/crawl'
import { extractTool as firecrawlExtractTool } from '@/tools/firecrawl/extract'
import { parseTool as firecrawlParseTool } from '@/tools/firecrawl/parse'
import { scrapeTool as firecrawlScrapeTool } from '@/tools/firecrawl/scrape'
import { firefliesUploadAudioTool } from '@/tools/fireflies/upload_audio'
import { readUrlTool as jinaReadUrlTool } from '@/tools/jina/read_url'
import { mistralParserTool, mistralParserV3Tool } from '@/tools/mistral/parser'
import { pulseParserTool, pulseParserV2Tool } from '@/tools/pulse/parser'
import { quiverImageToSvgTool } from '@/tools/quiver/image_to_svg'
import { quiverTextToSvgTool } from '@/tools/quiver/text_to_svg'
import { reductoParserTool, reductoParserV2Tool } from '@/tools/reducto/parser'
import { assemblyaiSttTool, assemblyaiSttV2Tool } from '@/tools/stt/assemblyai'
import { deepgramSttTool, deepgramSttV2Tool } from '@/tools/stt/deepgram'
import { elevenLabsSttTool, elevenLabsSttV2Tool } from '@/tools/stt/elevenlabs'
import { geminiSttTool, geminiSttV2Tool } from '@/tools/stt/gemini'
import { selectSttAudioModelInput } from '@/tools/stt/model-input'
import { whisperSttTool, whisperSttV2Tool } from '@/tools/stt/whisper'
import { crawlTool as tavilyCrawlTool } from '@/tools/tavily/crawl'
import { mapTool as tavilyMapTool } from '@/tools/tavily/map'
import { textractAnalyzeExpenseTool } from '@/tools/textract/analyze-expense'
import { textractAnalyzeIdTool } from '@/tools/textract/analyze-id'
import { textractParserTool, textractParserV2Tool } from '@/tools/textract/parser'
import type { ToolConfig } from '@/tools/types'
import { runwayVideoTool } from '@/tools/video/runway'
import { visionTool } from '@/tools/vision/tool'

function selectOpaqueModelInput(tool: ToolConfig, params: Record<string, unknown>): unknown {
  const modelInput = tool.request.modelInput
  if (!modelInput) throw new Error(`Missing model-input descriptor for ${tool.id}`)

  if (modelInput.mode === 'private-provenance') return modelInput.select(params)
  if (!modelInput.privateProvenance) {
    throw new Error(`Missing private provenance selector for ${tool.id}`)
  }
  return modelInput.privateProvenance(params)
}

function selectRejectedOpaqueModelInput(
  tool: ToolConfig,
  params: Record<string, unknown>
): unknown {
  const opaqueModelInput = tool.request.opaqueModelInput
  if (!opaqueModelInput) throw new Error(`Missing opaque model-input descriptor for ${tool.id}`)
  expect(opaqueModelInput.mode).toBe('reject-resolved-secrets')
  return opaqueModelInput.select(params)
}

describe('opaque model-input selectors', () => {
  it.each([
    extendParserTool,
    mistralParserTool,
    pulseParserTool,
    reductoParserTool,
    textractParserTool,
  ])('%s mirrors legacy path-first input precedence', (tool) => {
    expect(
      selectOpaqueModelInput(tool, {
        filePath: '  https://example.com/effective.pdf  ',
        file: { key: 'unused-file', metadata: 'unused-secret' },
        fileUpload: { key: 'unused-upload', metadata: 'unused-secret' },
      })
    ).toBe('https://example.com/effective.pdf')
  })

  it.each([extendParserV2Tool, pulseParserV2Tool, reductoParserV2Tool, textractParserV2Tool])(
    '%s selects only the effective locator from normalized files',
    (tool) => {
      expect(
        selectOpaqueModelInput(tool, {
          file: {
            key: 'effective-key',
            path: 'unused-path',
            url: 'unused-url',
            metadata: 'unused-secret',
          },
        })
      ).toBeUndefined()
    }
  )

  it('selects inline Mistral bytes without unrelated locators or metadata', () => {
    expect(
      selectOpaqueModelInput(mistralParserV3Tool, {
        file: {
          base64: 'effective-bytes',
          key: 'unused-key',
          type: 'application/pdf',
          metadata: 'unused-secret',
        },
      })
    ).toEqual({ base64: 'effective-bytes' })
  })

  it('selects only the active Textract source for sync and async requests', () => {
    expect(
      selectOpaqueModelInput(textractParserTool, {
        processingMode: 'async',
        s3Uri: '  s3://bucket/effective.pdf  ',
        filePath: 'https://example.com/unused.pdf',
        file: { key: 'unused-key', metadata: 'unused-secret' },
      })
    ).toBe('s3://bucket/effective.pdf')

    expect(
      selectOpaqueModelInput(textractAnalyzeExpenseTool, {
        processingMode: 'sync',
        file: { key: 'effective-key', metadata: 'unused-secret' },
        filePath: 'https://example.com/unused.pdf',
        s3Uri: 's3://bucket/unused.pdf',
      })
    ).toBeUndefined()

    expect(
      selectOpaqueModelInput(textractAnalyzeExpenseTool, {
        processingMode: 'async',
        s3Uri: '  s3://bucket/effective.pdf  ',
        file: { key: 'unused-key', metadata: 'unused-secret' },
      })
    ).toBe('s3://bucket/effective.pdf')
  })

  it('mirrors independent front and back precedence for Textract Analyze ID', () => {
    expect(
      selectOpaqueModelInput(textractAnalyzeIdTool, {
        file: { key: 'front-key', metadata: 'unused-secret' },
        filePath: 'https://example.com/unused-front.png',
        filePathBack: '  https://example.com/back.png  ',
      })
    ).toEqual({
      back: 'https://example.com/back.png',
    })
  })

  it('selects only the image source actually used by Vision', () => {
    expect(
      selectOpaqueModelInput(visionTool, {
        imageFile: {
          base64: 'effective-bytes',
          key: 'unused-key',
          type: 'image/png',
          metadata: 'unused-secret',
        },
        imageUrl: 'https://example.com/unused.png',
      })
    ).toEqual({ base64: 'effective-bytes' })
  })

  it('keeps A2A attachment metadata that is transmitted and drops everything else', () => {
    expect(
      selectOpaqueModelInput(a2aSendMessageTool, {
        files: [
          {
            key: 'effective-key',
            path: 'unused-path',
            name: 'report.pdf',
            type: 'application/pdf',
            metadata: 'unused-secret',
          },
        ],
      })
    ).toEqual([{ name: 'report.pdf' }])
  })

  it('keeps Firecrawl upload metadata that is transmitted and drops passthrough fields', () => {
    expect(
      selectOpaqueModelInput(firecrawlParseTool, {
        file: {
          key: 'effective-key',
          path: 'unused-path',
          name: 'report.pdf',
          type: 'application/pdf',
          metadata: 'unused-secret',
        },
      })
    ).toEqual({ name: 'report.pdf' })
  })

  it('mirrors Fireflies source precedence without selecting unused file metadata', () => {
    expect(firefliesUploadAudioTool.request.modelInput?.mode).toBe('project')
    if (firefliesUploadAudioTool.request.modelInput?.mode !== 'project') {
      throw new Error('Fireflies metadata must use the shared model-input projector')
    }
    expect(
      firefliesUploadAudioTool.request.modelInput.select({
        title: 'Meeting title',
        language: 'en',
        attendees: '[{"displayName":"Ada"}]',
        clientReferenceId: 'reference-1',
        webhook: 'https://example.com/private-callback',
      })
    ).toEqual({
      language: 'en',
    })

    expect(
      selectOpaqueModelInput(firefliesUploadAudioTool, {
        audioFile: {
          key: 'effective-key',
          url: 'https://example.com/unused.mp3',
          path: '/api/files/serve/unused.mp3',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused-fallback.mp3',
      })
    ).toBeUndefined()

    expect(
      selectOpaqueModelInput(firefliesUploadAudioTool, {
        audioFile: {
          url: 'https://example.com/effective.mp3',
          path: '/api/files/serve/unused.mp3',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused-fallback.mp3',
      })
    ).toEqual({ url: 'https://example.com/effective.mp3' })

    expect(
      selectOpaqueModelInput(firefliesUploadAudioTool, {
        audioUrl: 'https://example.com/fallback.mp3',
      })
    ).toBe('https://example.com/fallback.mp3')
  })

  it('normalizes Quiver file objects in both structured and serialized forms', () => {
    const serialized = JSON.stringify({
      key: 'effective-key',
      path: 'unused-path',
      metadata: 'unused-secret',
    })

    expect(selectOpaqueModelInput(quiverImageToSvgTool, { image: serialized })).toBeUndefined()
    expect(
      selectOpaqueModelInput(quiverTextToSvgTool, {
        references: [serialized, { path: 'effective-path', metadata: 'unused-secret' }],
      })
    ).toEqual([{ path: 'effective-path' }])
  })

  it('selects only STT source metadata that the target provider transmits', () => {
    expect(
      selectSttAudioModelInput({
        audioFile: {
          key: 'uploaded-key',
          name: 'uploaded.mp3',
          type: 'audio/mpeg',
          metadata: 'unused-secret',
        },
        audioFileReference: { key: 'unused-reference' },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toBeUndefined()

    expect(
      selectSttAudioModelInput({
        audioFileReference: {
          key: 'reference-key',
          name: 'reference.wav',
          type: 'audio/wav',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toBeUndefined()

    expect(
      selectSttAudioModelInput(
        {
          audioFile: {
            key: 'uploaded-key',
            name: 'uploaded.mp3',
            type: 'audio/mpeg',
            metadata: 'unused-secret',
          },
          audioUrl: 'https://example.com/unused.mp3',
        },
        { includeName: true }
      )
    ).toEqual({ name: 'uploaded.mp3' })

    expect(selectSttAudioModelInput({ audioUrl: '  https://example.com/audio.mp3  ' })).toBe(
      'https://example.com/audio.mp3'
    )
  })

  it.each([
    deepgramSttTool,
    deepgramSttV2Tool,
    assemblyaiSttTool,
    assemblyaiSttV2Tool,
    elevenLabsSttTool,
    elevenLabsSttV2Tool,
    geminiSttTool,
    geminiSttV2Tool,
    whisperSttTool,
    whisperSttV2Tool,
  ])('%s projects rewritable STT metadata and transports audio provenance privately', (tool) => {
    const modelInput = tool.request.modelInput
    expect(modelInput?.mode).toBe('project')
    if (modelInput?.mode !== 'project') {
      throw new Error(`Missing shared STT metadata projection for ${tool.id}`)
    }
    expect(modelInput.privateProvenance).toBeDefined()
    expect(
      modelInput.privateProvenance?.({
        audioFileReference: {
          key: 'effective-key',
          name: 'audio.mp3',
          type: 'audio/mpeg',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toEqual(tool.id.startsWith('stt_whisper') ? { name: 'audio.mp3' } : undefined)
    expect(modelInput.select({ language: 'en', prompt: 'Proper noun' })).toEqual(
      tool.id.startsWith('stt_whisper')
        ? { language: 'en', prompt: 'Proper noun' }
        : { language: 'en' }
    )
  })

  it.each([
    whisperSttTool,
    whisperSttV2Tool,
    deepgramSttTool,
    deepgramSttV2Tool,
    elevenLabsSttTool,
    elevenLabsSttV2Tool,
    assemblyaiSttTool,
    assemblyaiSttV2Tool,
    geminiSttTool,
    geminiSttV2Tool,
  ])('$id selects only opaque STT metadata transmitted upstream', (tool) => {
    expect(
      selectOpaqueModelInput(tool, {
        audioFileReference: {
          key: 'effective-key',
          name: 'audio.mp3',
          type: 'audio/mpeg',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toEqual(tool.id.startsWith('stt_whisper') ? { name: 'audio.mp3' } : undefined)
  })

  it('selects only the Runway visual reference fields consumed by the provider', () => {
    expect(
      selectOpaqueModelInput(runwayVideoTool, {
        visualReference: {
          key: 'effective-key',
          type: 'image/png',
          name: 'unused-name.png',
          metadata: 'unused-secret',
        },
      })
    ).toBeUndefined()
  })

  it.each([elevenLabsSpeechToSpeechTool, elevenLabsAudioIsolationTool])(
    '$id selects only the audio source consumed by ElevenLabs',
    (tool) => {
      expect(
        selectOpaqueModelInput(tool, {
          audioFile: {
            key: 'effective-key',
            name: 'audio.wav',
            type: 'audio/wav',
            metadata: 'unused-secret',
          },
        })
      ).toEqual({ name: 'audio.wav' })
    }
  )

  it.each([
    [
      exaFindSimilarLinksTool,
      { url: 'https://example.com/similar' },
      'https://example.com/similar',
    ],
    [firecrawlAgentTool, { urls: ['https://example.com/agent'] }, ['https://example.com/agent']],
    [
      firecrawlExtractTool,
      { urls: ['https://example.com/extract'] },
      ['https://example.com/extract'],
    ],
    [contextDevExtractTool, { url: 'https://example.com/extract' }, 'https://example.com/extract'],
    [
      contextDevExtractProductTool,
      { url: 'https://example.com/product' },
      'https://example.com/product',
    ],
    [contextDevExtractProductsTool, { domain: 'example.com' }, 'example.com'],
    [browserUseRunTaskTool, { startUrl: 'https://example.com/start' }, 'https://example.com/start'],
  ])('$id selects its exact always-model-bound opaque input', (tool, params, expected) => {
    expect(selectRejectedOpaqueModelInput(tool, params)).toStrictEqual(expected)
  })

  it('selects Exa content URLs only when summaries are model-generated', () => {
    expect(
      selectRejectedOpaqueModelInput(exaGetContentsTool, {
        urls: 'https://example.com/plain',
        summary: false,
      })
    ).toBeUndefined()
    expect(
      selectRejectedOpaqueModelInput(exaGetContentsTool, {
        urls: 'https://example.com/summary',
        summary: true,
      })
    ).toBe('https://example.com/summary')
    expect(
      selectRejectedOpaqueModelInput(exaGetContentsTool, {
        urls: 'https://example.com/query',
        summaryQuery: 'Summarize this',
      })
    ).toBe('https://example.com/query')
  })

  it('selects Firecrawl URLs only for formats or prompts that invoke models', () => {
    expect(
      selectRejectedOpaqueModelInput(firecrawlScrapeTool, {
        url: 'https://example.com/plain',
        formats: ['markdown'],
      })
    ).toBeUndefined()
    expect(
      selectRejectedOpaqueModelInput(firecrawlScrapeTool, {
        url: 'https://example.com/json',
        formats: [{ type: 'json', schema: { type: 'object' } }],
      })
    ).toBe('https://example.com/json')
    expect(
      selectRejectedOpaqueModelInput(firecrawlScrapeTool, {
        url: 'https://example.com/string-json',
        formats: ['json'],
      })
    ).toBe('https://example.com/string-json')
    expect(
      selectRejectedOpaqueModelInput(firecrawlBatchScrapeTool, {
        urls: ['https://example.com/question'],
        scrapeOptions: { formats: [{ type: 'question', question: 'What changed?' }] },
      })
    ).toStrictEqual(['https://example.com/question'])
    expect(
      selectRejectedOpaqueModelInput(firecrawlCrawlTool, {
        url: 'https://example.com/plain-crawl',
        formats: ['markdown'],
      })
    ).toBeUndefined()
    expect(
      selectRejectedOpaqueModelInput(firecrawlCrawlTool, {
        url: 'https://example.com/prompted-crawl',
        prompt: 'Focus on pricing',
      })
    ).toBe('https://example.com/prompted-crawl')
  })

  it.each([tavilyCrawlTool, tavilyMapTool])(
    '$id selects its URL only when natural-language instructions are active',
    (tool) => {
      expect(
        selectRejectedOpaqueModelInput(tool, {
          url: 'https://example.com/plain',
        })
      ).toBeUndefined()
      expect(
        selectRejectedOpaqueModelInput(tool, {
          url: 'https://example.com/instructed',
          instructions: 'Find pricing',
        })
      ).toBe('https://example.com/instructed')
    }
  )

  it('selects Jina Reader URLs only for ReaderLM or generated-alt processing', () => {
    expect(
      selectRejectedOpaqueModelInput(jinaReadUrlTool, { url: 'https://example.com/plain' })
    ).toBeUndefined()
    expect(
      selectRejectedOpaqueModelInput(jinaReadUrlTool, {
        url: 'https://example.com/readerlm',
        useReaderLMv2: true,
      })
    ).toBe('https://example.com/readerlm')
    expect(
      selectRejectedOpaqueModelInput(jinaReadUrlTool, {
        url: 'https://example.com/alt',
        withGeneratedAlt: true,
      })
    ).toBe('https://example.com/alt')
  })

  it.each([launchAgentTool, launchAgentV2Tool, addFollowupTool, addFollowupV2Tool])(
    '$id selects the parsed Cursor image payload without rewriting it',
    (tool) => {
      const promptImages = JSON.stringify([
        { data: 'quote" slash\\ newline\n123 true', dimension: { width: 10, height: 20 } },
      ])
      expect(selectRejectedOpaqueModelInput(tool, { promptImages })).toStrictEqual([
        { data: 'quote" slash\\ newline\n123 true', dimension: { width: 10, height: 20 } },
      ])
      expect(selectRejectedOpaqueModelInput(tool, { promptImages: 'not-json' })).toStrictEqual([])
    }
  )
})
