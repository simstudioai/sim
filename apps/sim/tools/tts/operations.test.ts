/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { elevenLabsTtsTool } from '@/tools/elevenlabs/tts'
import { azureTtsTool } from '@/tools/tts/azure'
import { cartesiaTtsTool } from '@/tools/tts/cartesia'
import { deepgramTtsTool } from '@/tools/tts/deepgram'
import { elevenLabsTtsUnifiedTool } from '@/tools/tts/elevenlabs'
import { gandrTtsTool } from '@/tools/tts/gandr'
import { googleTtsTool } from '@/tools/tts/google'
import { openaiTtsTool } from '@/tools/tts/openai'
import { playhtTtsTool } from '@/tools/tts/playht'

const TOOLS = [
  elevenLabsTtsTool,
  openaiTtsTool,
  deepgramTtsTool,
  elevenLabsTtsUnifiedTool,
  cartesiaTtsTool,
  googleTtsTool,
  azureTtsTool,
  playhtTtsTool,
  gandrTtsTool,
] as const

describe('TTS operation declarations', () => {
  it('uses only the in-process operation boundary and projects text model input', () => {
    for (const tool of TOOLS) {
      expect(tool.request).toBeUndefined()
      expect(tool.operation.modelInput?.mode).toBe('project')
      if (tool.operation.modelInput?.mode === 'project') {
        expect(tool.operation.modelInput.select({ text: 'Speak this' })).toEqual({
          text: 'Speak this',
        })
      }
    }
  })

  it('materializes provider input without HTTP or caller-authored execution context', () => {
    expect(openaiTtsTool.operation.input({ text: 'Hello', apiKey: 'key' })).toEqual({
      text: 'Hello',
      apiKey: 'key',
      model: 'tts-1',
      voice: 'alloy',
      responseFormat: 'mp3',
      speed: 1,
    })
    expect(gandrTtsTool.operation.input({ text: 'Hello', apiKey: 'key' })).toEqual({
      text: 'Hello',
      apiKey: 'key',
      voice: 'gandr-mia',
      responseFormat: 'mp3',
    })
    expect(
      elevenLabsTtsTool.operation.input({ text: 'Hello', apiKey: 'key', voiceId: 'voice_1' })
    ).toEqual({
      text: 'Hello',
      apiKey: 'key',
      voiceId: 'voice_1',
      modelId: 'eleven_monolingual_v1',
      stability: undefined,
      similarityBoost: undefined,
    })
  })
})
