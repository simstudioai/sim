/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { deepgramSttTool } from '@/tools/stt/deepgram'
import { whisperSttTool } from '@/tools/stt/whisper'
import type { ToolConfig } from '@/tools/types'

const AUDIO_FILE = {
  name: 'secret-recording.mp3',
  key: 'workspace/ws-1/secret-recording.mp3',
}

function selectPrivateInputPaths(tool: ToolConfig): readonly (readonly string[])[] {
  const modelInput = tool.request.modelInput
  expect(modelInput?.mode).toBe('project')
  if (modelInput?.mode !== 'project') throw new Error(`Expected ${tool.id} to project model input`)
  return modelInput.privateInputPaths?.({ audioFile: AUDIO_FILE }) ?? []
}

describe('STT model input provenance', () => {
  it('excludes filenames by default when the provider receives only audio bytes', () => {
    expect(selectPrivateInputPaths(deepgramSttTool)).toEqual([])
  })

  it('selects the filename only for Whisper, which serializes it upstream', () => {
    expect(selectPrivateInputPaths(whisperSttTool)).toEqual([['audioFile', 'name']])
  })
})
