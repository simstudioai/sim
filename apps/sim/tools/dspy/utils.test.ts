import { describe, expect, it } from 'vitest'
import { buildDSPyUrl } from '@/tools/dspy/utils'

describe('buildDSPyUrl', () => {
  it('adds the slash an endpoint path was typed without', () => {
    expect(buildDSPyUrl('https://dspy.example.com/', 'predict')).toBe(
      'https://dspy.example.com/predict'
    )
  })

  it('defaults to /predict', () => {
    expect(buildDSPyUrl('https://dspy.example.com', '')).toBe('https://dspy.example.com/predict')
  })
})
