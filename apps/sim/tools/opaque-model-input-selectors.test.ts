/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { a2aSendMessageTool } from '@/tools/a2a/send_message'
import { elevenLabsAudioIsolationTool } from '@/tools/elevenlabs/audio-isolation'
import { elevenLabsSpeechToSpeechTool } from '@/tools/elevenlabs/speech-to-speech'
import { extendParserTool, extendParserV2Tool } from '@/tools/extend/parser'
import { parseTool as firecrawlParseTool } from '@/tools/firecrawl/parse'
import { firefliesUploadAudioTool } from '@/tools/fireflies/upload_audio'
import { mistralParserTool, mistralParserV3Tool } from '@/tools/mistral/parser'
import { pulseParserTool, pulseParserV2Tool } from '@/tools/pulse/parser'
import { quiverImageToSvgTool } from '@/tools/quiver/image_to_svg'
import { quiverTextToSvgTool } from '@/tools/quiver/text_to_svg'
import { reductoParserTool, reductoParserV2Tool } from '@/tools/reducto/parser'
import { projectToolModelInputParams } from '@/tools/request-transport'
import { assemblyaiSttTool, assemblyaiSttV2Tool } from '@/tools/stt/assemblyai'
import { deepgramSttTool, deepgramSttV2Tool } from '@/tools/stt/deepgram'
import { elevenLabsSttTool, elevenLabsSttV2Tool } from '@/tools/stt/elevenlabs'
import { geminiSttTool, geminiSttV2Tool } from '@/tools/stt/gemini'
import { whisperSttTool, whisperSttV2Tool } from '@/tools/stt/whisper'
import { textractAnalyzeExpenseTool } from '@/tools/textract/analyze-expense'
import { textractAnalyzeIdTool } from '@/tools/textract/analyze-id'
import { textractParserTool, textractParserV2Tool } from '@/tools/textract/parser'
import type { ExecutableToolConfig } from '@/tools/types'
import { runwayVideoTool } from '@/tools/video/runway'
import { visionTool } from '@/tools/vision/tool'

const FILE = {
  key: 'workspace/ws-1/report.pdf',
  path: '/api/files/serve/workspace/ws-1/report.pdf',
  url: 'https://storage.example/report.pdf?signature=private',
  base64: 'raw-inline-field',
  name: 'private-report.pdf',
  size: 42,
  type: 'application/pdf',
}

function selectPrivateInputPaths(
  tool: ExecutableToolConfig,
  params: Record<string, unknown>
): readonly (readonly string[])[] {
  const modelInput = getModelInput(tool)
  if (!modelInput) return []
  if (modelInput.mode === 'private-provenance') return modelInput.inputPaths(params)
  return modelInput.privateInputPaths?.(params) ?? []
}

function getModelInput(tool: ExecutableToolConfig) {
  return tool.operation?.modelInput ?? tool.request?.modelInput
}

function getProjectingModelInput(tool: ExecutableToolConfig) {
  const modelInput = getModelInput(tool)
  expect(modelInput?.mode).toBe('project')
  if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
    throw new Error(`Expected ${tool.id} to apply projected model input`)
  }
  return modelInput
}

describe('file model-input selectors', () => {
  it.each([
    extendParserTool,
    extendParserV2Tool,
    pulseParserTool,
    pulseParserV2Tool,
    reductoParserTool,
    reductoParserV2Tool,
    textractParserTool,
    textractParserV2Tool,
    textractAnalyzeExpenseTool,
    textractAnalyzeIdTool,
    firefliesUploadAudioTool,
    deepgramSttTool,
    deepgramSttV2Tool,
    assemblyaiSttTool,
    assemblyaiSttV2Tool,
    elevenLabsSttTool,
    elevenLabsSttV2Tool,
    geminiSttTool,
    geminiSttV2Tool,
  ])('$id does not attach private provenance for server-resolved locators', (tool) => {
    expect(selectPrivateInputPaths(tool, { file: FILE, filePath: FILE.url })).toEqual([])
    const modelInput = getModelInput(tool)
    expect(modelInput?.mode).not.toBe('private-provenance')
    if (modelInput?.mode === 'project') {
      expect(modelInput.privateInputPaths).toBeUndefined()
    }
  })

  it('does not attach private provenance to the Runway server-resolved locator', () => {
    const modelInput = runwayVideoTool.operation.modelInput
    expect(modelInput?.mode).toBe('project')
    if (modelInput?.mode === 'project') {
      expect(modelInput.privateInputPaths).toBeUndefined()
    }
  })

  it('keeps only inline Mistral bytes fail-closed', () => {
    expect(
      selectPrivateInputPaths(mistralParserTool, {
        filePath: 'https://example.com/document.pdf?token=private',
      })
    ).toEqual([])
    expect(
      selectPrivateInputPaths(mistralParserTool, {
        filePath: 'data:application/pdf;base64,c2VjcmV0',
      })
    ).toEqual([['filePath']])
    expect(
      selectPrivateInputPaths(mistralParserV3Tool, {
        file: { ...FILE, base64: 'effective-inline-bytes' },
      })
    ).toEqual([['file', 'base64']])
  })

  it('keeps only inline Vision bytes fail-closed', () => {
    expect(
      selectPrivateInputPaths(visionTool, {
        imageUrl: 'https://example.com/image.png?token=private',
      })
    ).toEqual([])
    expect(
      selectPrivateInputPaths(visionTool, {
        imageUrl: 'data:image/png;base64,c2VjcmV0',
      })
    ).toEqual([['imageUrl']])
    expect(
      selectPrivateInputPaths(visionTool, {
        imageFile: { ...FILE, base64: 'effective-inline-bytes' },
      })
    ).toEqual([['imageFile', 'base64']])
  })

  it('treats Quiver URLs as locators and data URLs as inline media', () => {
    const serializedFile = JSON.stringify(FILE)
    expect(selectPrivateInputPaths(quiverImageToSvgTool, { image: serializedFile })).toEqual([])
    expect(
      selectPrivateInputPaths(quiverTextToSvgTool, {
        references: [serializedFile, 'https://example.com/reference.png'],
      })
    ).toEqual([])
    expect(
      selectPrivateInputPaths(quiverImageToSvgTool, {
        image: 'data:image/png;base64,c2VjcmV0',
      })
    ).toEqual([['image']])
  })

  it('projects A2A attachment names without rewriting file content or locators', () => {
    const modelInput = getProjectingModelInput(a2aSendMessageTool)
    expect(modelInput.select({ message: 'Analyze', files: [FILE] })).toEqual({
      message: 'Analyze',
      data: undefined,
      files: [{ name: 'private-report.pdf' }],
    })
    expect(
      modelInput.applyProjected(
        { message: 'Analyze', data: undefined, files: [FILE] },
        { message: 'Analyze', data: undefined, files: [{ name: '{{FILE_NAME}}' }] }
      )
    ).toEqual({ message: 'Analyze', data: undefined, files: [{ ...FILE, name: '{{FILE_NAME}}' }] })
  })

  it('restores non-name A2A fields after the whole selected file param is projected', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FILE_NAME', plaintext: 'private-report', encryptedValue: 'encrypted-name' },
      { name: 'FILE_URL', plaintext: 'private', encryptedValue: 'encrypted-url' },
      { name: 'INLINE_FIELD', plaintext: 'raw-inline-field', encryptedValue: 'encrypted-inline' },
    ])
    registry.recordResolvedAtInputPath('FILE_NAME', 'private-report', ['files', '0', 'name'])
    registry.recordResolvedInputProjection(
      ['files', '0', 'name'],
      'private-report.pdf',
      '{{FILE_NAME}}.pdf'
    )
    registry.recordResolvedAtInputPath('FILE_URL', 'private', ['files', '0', 'url'])
    registry.recordResolvedInputProjection(
      ['files', '0', 'url'],
      FILE.url,
      'https://storage.example/report.pdf?signature={{FILE_URL}}'
    )
    registry.recordResolvedAtInputPath('INLINE_FIELD', 'raw-inline-field', ['files', '0', 'base64'])
    registry.recordResolvedInputProjection(
      ['files', '0', 'base64'],
      FILE.base64,
      '{{INLINE_FIELD}}'
    )

    expect(
      projectToolModelInputParams(
        a2aSendMessageTool,
        { message: 'Analyze', files: [FILE] },
        registry
      )
    ).toEqual({
      message: 'Analyze',
      data: undefined,
      files: [{ ...FILE, name: '{{FILE_NAME}}.pdf' }],
    })
  })

  it('projects the Firecrawl multipart filename without rewriting the stored file', () => {
    const modelInput = getProjectingModelInput(firecrawlParseTool)
    expect(modelInput.select({ file: FILE, formats: ['summary'] })).toEqual({
      formats: [{}],
      file: { name: 'private-report.pdf' },
    })
    expect(
      modelInput.applyProjected(
        { file: FILE, formats: ['summary'] },
        { formats: [{}], file: { name: '{{FILE_NAME}}' } }
      )
    ).toEqual({ formats: ['summary'], file: { ...FILE, name: '{{FILE_NAME}}' } })
  })

  it.each([whisperSttTool, whisperSttV2Tool])(
    '$id projects the multipart filename without rewriting the audio source',
    (tool) => {
      const modelInput = getProjectingModelInput(tool)
      expect(
        modelInput.applyProjected(
          { language: 'en', prompt: 'Hint', audioFile: FILE },
          {
            language: 'en',
            prompt: 'Hint',
            audioFile: { name: '{{FILE_NAME}}' },
          }
        )
      ).toEqual({
        language: 'en',
        prompt: 'Hint',
        audioFile: { ...FILE, name: '{{FILE_NAME}}' },
      })
    }
  )

  it.each([elevenLabsSpeechToSpeechTool, elevenLabsAudioIsolationTool])(
    '$id projects the multipart filename without rewriting the audio source',
    (tool) => {
      const modelInput = getProjectingModelInput(tool)
      expect(modelInput.select({ audioFile: FILE })).toEqual({
        audioFile: { name: 'private-report.pdf' },
      })
      expect(
        modelInput.applyProjected({ audioFile: FILE }, { audioFile: { name: '{{FILE_NAME}}' } })
      ).toEqual({ audioFile: { ...FILE, name: '{{FILE_NAME}}' } })
    }
  )
})
