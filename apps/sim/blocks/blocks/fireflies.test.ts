import { describe, expect, it } from 'vitest'
import { FirefliesBlock, FirefliesV2Block } from '@/blocks/blocks/fireflies'
import type { BlockConfig, BlockToolParamsContext } from '@/blocks/types'

function mapParams(
  block: BlockConfig,
  params: Record<string, unknown>,
  context?: BlockToolParamsContext
) {
  const mapper = block.tools.config?.params
  if (!mapper) throw new Error('Fireflies block has no params mapper')
  return mapper(params, context)
}

describe('Fireflies tool calls', () => {
  it('uploads a picked file by its https URL when the operation arrives only in the context', () => {
    const mapped = mapParams(
      FirefliesV2Block,
      { audioFile: { name: 'call.mp3', url: 'https://files.example.com/call.mp3' } },
      { operation: 'fireflies_upload_audio' }
    )
    expect(mapped.audioUrl).toBe('https://files.example.com/call.mp3')
    expect(mapped.audioFile).toBeUndefined()
  })

  it('keeps the model bite name and a zero start time', () => {
    const mapped = mapParams(
      FirefliesBlock,
      { transcriptId: 't1', startTime: 0, endTime: 30, name: 'Intro', summary: 'Opening' },
      { operation: 'fireflies_create_bite' }
    )
    expect(mapped).toMatchObject({ startTime: 0, endTime: 30, name: 'Intro', summary: 'Opening' })
  })
})
