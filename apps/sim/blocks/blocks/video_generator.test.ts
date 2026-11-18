import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { VideoGeneratorV3Block } from '@/blocks/blocks/video_generator'

const frame = { id: 'f', name: 'frame.png', url: '', size: 3, type: 'image/png', key: 'k' }

function aspectRatioField() {
  const field = VideoGeneratorV3Block.subBlocks.find((subBlock) => subBlock.id === 'falAspectRatio')
  if (!field) throw new Error('Video Generator must expose a fal aspect ratio field')
  return field
}

function optionIds(values: Record<string, unknown>) {
  const { options } = aspectRatioField()
  if (typeof options !== 'function') throw new Error('Fal aspect ratio options must be derived')
  return options({ values }).map((option) => (typeof option === 'string' ? option : option.id))
}

describe('Video Generator fal start frame', () => {
  // Happy Horse takes an aspect ratio from a prompt but not from a start frame.
  const base = { provider: 'falai', model: 'alibaba/happy-horse/text-to-video' }

  it('reads the prompt endpoint when the stored upload is in the inactive mode', () => {
    const values = {
      ...base,
      visualReferenceUpload: frame,
      visualReferenceInput: '',
      __canonicalModes: { visualReference: 'advanced' },
    }

    expect(evaluateSubBlockCondition(aspectRatioField().condition, values)).toBe(true)
    expect(optionIds(values)).toContain('16:9')
  })

  it('reads the start frame endpoint when the upload is the active mode', () => {
    const values = { ...base, visualReferenceUpload: frame }

    expect(evaluateSubBlockCondition(aspectRatioField().condition, values)).toBe(false)
    expect(optionIds(values)).not.toContain('16:9')
  })
})
