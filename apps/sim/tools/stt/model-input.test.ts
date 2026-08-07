/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { deepgramSttTool } from '@/tools/stt/deepgram'
import { selectSttAudioModelInput } from '@/tools/stt/model-input'
import { whisperSttTool } from '@/tools/stt/whisper'
import type { ToolConfig } from '@/tools/types'

const AUDIO_FILE = {
  name: 'secret-recording.mp3',
  key: 'workspace/ws-1/secret-recording.mp3',
}

function selectPrivateProvenance(tool: ToolConfig): unknown {
  const modelInput = tool.request.modelInput
  expect(modelInput?.mode).toBe('project')
  if (modelInput?.mode !== 'project') throw new Error(`Expected ${tool.id} to project model input`)
  return modelInput.privateProvenance?.({ audioFile: AUDIO_FILE })
}

describe('STT model input provenance', () => {
  it('excludes filenames by default when the provider receives only audio bytes', () => {
    expect(selectSttAudioModelInput({ audioFile: AUDIO_FILE })).toBeUndefined()
    expect(selectPrivateProvenance(deepgramSttTool)).toBeUndefined()
  })

  it('selects the filename only for Whisper, which serializes it upstream', () => {
    expect(selectPrivateProvenance(whisperSttTool)).toEqual({ name: 'secret-recording.mp3' })
  })
})
