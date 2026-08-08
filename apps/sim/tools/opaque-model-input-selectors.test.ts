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
import { selectSttAudioModelInputPaths } from '@/tools/stt/model-input'
import { whisperSttTool, whisperSttV2Tool } from '@/tools/stt/whisper'
import { crawlTool as tavilyCrawlTool } from '@/tools/tavily/crawl'
import { mapTool as tavilyMapTool } from '@/tools/tavily/map'
import { textractAnalyzeExpenseTool } from '@/tools/textract/analyze-expense'
import { textractAnalyzeIdTool } from '@/tools/textract/analyze-id'
import { textractParserTool, textractParserV2Tool } from '@/tools/textract/parser'
import type { ToolConfig } from '@/tools/types'
import { runwayVideoTool } from '@/tools/video/runway'
import { visionTool } from '@/tools/vision/tool'

function selectOpaqueModelInputPaths(
  tool: ToolConfig,
  params: Record<string, unknown>
): readonly (readonly string[])[] {
  const modelInput = tool.request.modelInput
  if (!modelInput) throw new Error(`Missing model-input descriptor for ${tool.id}`)

  if (modelInput.mode === 'private-provenance') return modelInput.inputPaths(params)
  if (!modelInput.privateInputPaths) {
    throw new Error(`Missing private provenance selector for ${tool.id}`)
  }
  return modelInput.privateInputPaths(params)
}

function selectRejectedOpaqueModelInputPaths(
  tool: ToolConfig,
  params: Record<string, unknown>
): readonly (readonly string[])[] {
  const opaqueModelInput = tool.request.opaqueModelInput
  if (!opaqueModelInput) throw new Error(`Missing opaque model-input descriptor for ${tool.id}`)
  expect(opaqueModelInput.mode).toBe('reject-resolved-secrets')
  return opaqueModelInput.inputPaths(params)
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
      selectOpaqueModelInputPaths(tool, {
        filePath: '  https://example.com/effective.pdf  ',
        file: { key: 'unused-file', metadata: 'unused-secret' },
        fileUpload: { key: 'unused-upload', metadata: 'unused-secret' },
      })
    ).toEqual([['filePath']])
  })

  it.each([extendParserV2Tool, pulseParserV2Tool, reductoParserV2Tool, textractParserV2Tool])(
    '%s selects only the effective locator from normalized files',
    (tool) => {
      expect(
        selectOpaqueModelInputPaths(tool, {
          file: {
            key: 'effective-key',
            path: 'unused-path',
            url: 'unused-url',
            metadata: 'unused-secret',
          },
        })
      ).toEqual([])
    }
  )

  it('selects inline Mistral bytes without unrelated locators or metadata', () => {
    expect(
      selectOpaqueModelInputPaths(mistralParserV3Tool, {
        file: {
          base64: 'effective-bytes',
          key: 'unused-key',
          type: 'application/pdf',
          metadata: 'unused-secret',
        },
      })
    ).toEqual([['file', 'base64']])
  })

  it('selects only the active Textract source for sync and async requests', () => {
    expect(
      selectOpaqueModelInputPaths(textractParserTool, {
        processingMode: 'async',
        s3Uri: '  s3://bucket/effective.pdf  ',
        filePath: 'https://example.com/unused.pdf',
        file: { key: 'unused-key', metadata: 'unused-secret' },
      })
    ).toEqual([['s3Uri']])

    expect(
      selectOpaqueModelInputPaths(textractAnalyzeExpenseTool, {
        processingMode: 'sync',
        file: { key: 'effective-key', metadata: 'unused-secret' },
        filePath: 'https://example.com/unused.pdf',
        s3Uri: 's3://bucket/unused.pdf',
      })
    ).toEqual([])

    expect(
      selectOpaqueModelInputPaths(textractAnalyzeExpenseTool, {
        processingMode: 'async',
        s3Uri: '  s3://bucket/effective.pdf  ',
        file: { key: 'unused-key', metadata: 'unused-secret' },
      })
    ).toEqual([['s3Uri']])
  })

  it('mirrors independent front and back precedence for Textract Analyze ID', () => {
    expect(
      selectOpaqueModelInputPaths(textractAnalyzeIdTool, {
        file: { key: 'front-key', metadata: 'unused-secret' },
        filePath: 'https://example.com/unused-front.png',
        filePathBack: '  https://example.com/back.png  ',
      })
    ).toEqual([['filePathBack']])
  })

  it('selects only the image source actually used by Vision', () => {
    expect(
      selectOpaqueModelInputPaths(visionTool, {
        imageFile: {
          base64: 'effective-bytes',
          key: 'unused-key',
          type: 'image/png',
          metadata: 'unused-secret',
        },
        imageUrl: 'https://example.com/unused.png',
      })
    ).toEqual([['imageFile', 'base64']])
  })

  it('keeps A2A attachment metadata that is transmitted and drops everything else', () => {
    expect(
      selectOpaqueModelInputPaths(a2aSendMessageTool, {
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
    ).toEqual([['files', '0', 'name']])
  })

  it('keeps Firecrawl upload metadata that is transmitted and drops passthrough fields', () => {
    expect(
      selectOpaqueModelInputPaths(firecrawlParseTool, {
        file: {
          key: 'effective-key',
          path: 'unused-path',
          name: 'report.pdf',
          type: 'application/pdf',
          metadata: 'unused-secret',
        },
      })
    ).toEqual([['file', 'name']])
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
      selectOpaqueModelInputPaths(firefliesUploadAudioTool, {
        audioFile: {
          key: 'effective-key',
          url: 'https://example.com/unused.mp3',
          path: '/api/files/serve/unused.mp3',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused-fallback.mp3',
      })
    ).toEqual([])

    expect(
      selectOpaqueModelInputPaths(firefliesUploadAudioTool, {
        audioFile: {
          url: 'https://example.com/effective.mp3',
          path: '/api/files/serve/unused.mp3',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused-fallback.mp3',
      })
    ).toEqual([['audioFile', 'url']])

    expect(
      selectOpaqueModelInputPaths(firefliesUploadAudioTool, {
        audioUrl: 'https://example.com/fallback.mp3',
      })
    ).toEqual([['audioUrl']])
  })

  it('normalizes Quiver file objects in both structured and serialized forms', () => {
    const serialized = JSON.stringify({
      key: 'effective-key',
      path: 'unused-path',
      metadata: 'unused-secret',
    })

    expect(selectOpaqueModelInputPaths(quiverImageToSvgTool, { image: serialized })).toEqual([])
    expect(
      selectOpaqueModelInputPaths(quiverTextToSvgTool, {
        references: [serialized, { path: 'effective-path', metadata: 'unused-secret' }],
      })
    ).toEqual([['references', '1', 'path']])
  })

  it('selects only STT source metadata that the target provider transmits', () => {
    expect(
      selectSttAudioModelInputPaths({
        audioFile: {
          key: 'uploaded-key',
          name: 'uploaded.mp3',
          type: 'audio/mpeg',
          metadata: 'unused-secret',
        },
        audioFileReference: { key: 'unused-reference' },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toEqual([])

    expect(
      selectSttAudioModelInputPaths({
        audioFileReference: {
          key: 'reference-key',
          name: 'reference.wav',
          type: 'audio/wav',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toEqual([])

    expect(
      selectSttAudioModelInputPaths(
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
    ).toEqual([['audioFile', 'name']])

    expect(
      selectSttAudioModelInputPaths({ audioUrl: '  https://example.com/audio.mp3  ' })
    ).toEqual([['audioUrl']])
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
    expect(modelInput.privateInputPaths).toBeDefined()
    expect(
      modelInput.privateInputPaths?.({
        audioFileReference: {
          key: 'effective-key',
          name: 'audio.mp3',
          type: 'audio/mpeg',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toEqual(tool.id.startsWith('stt_whisper') ? [['audioFileReference', 'name']] : [])
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
      selectOpaqueModelInputPaths(tool, {
        audioFileReference: {
          key: 'effective-key',
          name: 'audio.mp3',
          type: 'audio/mpeg',
          metadata: 'unused-secret',
        },
        audioUrl: 'https://example.com/unused.mp3',
      })
    ).toEqual(tool.id.startsWith('stt_whisper') ? [['audioFileReference', 'name']] : [])
  })

  it('selects only the Runway visual reference fields consumed by the provider', () => {
    expect(
      selectOpaqueModelInputPaths(runwayVideoTool, {
        visualReference: {
          key: 'effective-key',
          type: 'image/png',
          name: 'unused-name.png',
          metadata: 'unused-secret',
        },
      })
    ).toEqual([])
  })

  it.each([elevenLabsSpeechToSpeechTool, elevenLabsAudioIsolationTool])(
    '$id selects only the audio source consumed by ElevenLabs',
    (tool) => {
      expect(
        selectOpaqueModelInputPaths(tool, {
          audioFile: {
            key: 'effective-key',
            name: 'audio.wav',
            type: 'audio/wav',
            metadata: 'unused-secret',
          },
        })
      ).toEqual([['audioFile', 'name']])
    }
  )

  it.each([
    [exaFindSimilarLinksTool, { url: 'https://example.com/similar' }, [['url']]],
    [firecrawlAgentTool, { urls: ['https://example.com/agent'] }, [['urls']]],
    [firecrawlExtractTool, { urls: ['https://example.com/extract'] }, [['urls']]],
    [contextDevExtractTool, { url: 'https://example.com/extract' }, [['url']]],
    [contextDevExtractProductTool, { url: 'https://example.com/product' }, [['url']]],
    [contextDevExtractProductsTool, { domain: 'example.com' }, [['domain']]],
    [browserUseRunTaskTool, { startUrl: 'https://example.com/start' }, [['startUrl']]],
  ])('$id selects its exact always-model-bound opaque input', (tool, params, expected) => {
    expect(selectRejectedOpaqueModelInputPaths(tool, params)).toStrictEqual(expected)
  })

  it('selects Exa content URLs only when summaries are model-generated', () => {
    expect(
      selectRejectedOpaqueModelInputPaths(exaGetContentsTool, {
        urls: 'https://example.com/plain',
        summary: false,
      })
    ).toEqual([])
    expect(
      selectRejectedOpaqueModelInputPaths(exaGetContentsTool, {
        urls: 'https://example.com/summary',
        summary: true,
      })
    ).toEqual([['urls']])
    expect(
      selectRejectedOpaqueModelInputPaths(exaGetContentsTool, {
        urls: 'https://example.com/query',
        summaryQuery: 'Summarize this',
      })
    ).toEqual([['urls']])
  })

  it('selects Firecrawl URLs only for formats or prompts that invoke models', () => {
    expect(
      selectRejectedOpaqueModelInputPaths(firecrawlScrapeTool, {
        url: 'https://example.com/plain',
        formats: ['markdown'],
      })
    ).toEqual([])
    expect(
      selectRejectedOpaqueModelInputPaths(firecrawlScrapeTool, {
        url: 'https://example.com/json',
        formats: [{ type: 'json', schema: { type: 'object' } }],
      })
    ).toEqual([['url']])
    expect(
      selectRejectedOpaqueModelInputPaths(firecrawlScrapeTool, {
        url: 'https://example.com/string-json',
        formats: ['json'],
      })
    ).toEqual([['url']])
    expect(
      selectRejectedOpaqueModelInputPaths(firecrawlBatchScrapeTool, {
        urls: ['https://example.com/question'],
        scrapeOptions: { formats: [{ type: 'question', question: 'What changed?' }] },
      })
    ).toStrictEqual([['urls']])
    expect(
      selectRejectedOpaqueModelInputPaths(firecrawlCrawlTool, {
        url: 'https://example.com/plain-crawl',
        formats: ['markdown'],
      })
    ).toEqual([])
    expect(
      selectRejectedOpaqueModelInputPaths(firecrawlCrawlTool, {
        url: 'https://example.com/prompted-crawl',
        prompt: 'Focus on pricing',
      })
    ).toEqual([['url']])
  })

  it.each([tavilyCrawlTool, tavilyMapTool])(
    '$id selects its URL only when natural-language instructions are active',
    (tool) => {
      expect(
        selectRejectedOpaqueModelInputPaths(tool, {
          url: 'https://example.com/plain',
        })
      ).toEqual([])
      expect(
        selectRejectedOpaqueModelInputPaths(tool, {
          url: 'https://example.com/instructed',
          instructions: 'Find pricing',
        })
      ).toEqual([['url']])
    }
  )

  it('selects Jina Reader URLs only for ReaderLM or generated-alt processing', () => {
    expect(
      selectRejectedOpaqueModelInputPaths(jinaReadUrlTool, { url: 'https://example.com/plain' })
    ).toEqual([])
    expect(
      selectRejectedOpaqueModelInputPaths(jinaReadUrlTool, {
        url: 'https://example.com/readerlm',
        useReaderLMv2: true,
      })
    ).toEqual([['url']])
    expect(
      selectRejectedOpaqueModelInputPaths(jinaReadUrlTool, {
        url: 'https://example.com/alt',
        withGeneratedAlt: true,
      })
    ).toEqual([['url']])
  })

  it.each([launchAgentTool, launchAgentV2Tool, addFollowupTool, addFollowupV2Tool])(
    '$id selects the parsed Cursor image payload without rewriting it',
    (tool) => {
      const promptImages = JSON.stringify([
        { data: 'quote" slash\\ newline\n123 true', dimension: { width: 10, height: 20 } },
      ])
      expect(selectRejectedOpaqueModelInputPaths(tool, { promptImages })).toStrictEqual([
        ['promptImages'],
      ])
      expect(selectRejectedOpaqueModelInputPaths(tool, { promptImages: 'not-json' })).toStrictEqual(
        []
      )
    }
  )
})
