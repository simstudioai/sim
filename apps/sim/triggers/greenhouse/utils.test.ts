/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isGreenhouseEventMatch } from '@/triggers/greenhouse/utils'

describe('isGreenhouseEventMatch', () => {
  it('matches mapped trigger ids to Greenhouse action strings', () => {
    expect(isGreenhouseEventMatch('greenhouse_new_application', 'new_candidate_application')).toBe(
      true
    )
    expect(isGreenhouseEventMatch('greenhouse_new_application', 'hire_candidate')).toBe(false)
  })

  it('rejects unknown trigger ids (no permissive fallback)', () => {
    expect(isGreenhouseEventMatch('greenhouse_unknown', 'new_candidate_application')).toBe(false)
  })
})
