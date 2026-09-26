/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { resolveMothershipModelSettings } from '@/lib/mothership/model-options'

describe('Plan model defaults', () => {
  it.each([true, false])('defaults Plan to Opus Medium with advanced=%s', (advanced) => {
    expect(resolveMothershipModelSettings({}, advanced, true)).toEqual({
      effort: 'medium',
      modelSelection: { model: 'claude-opus-5-5', fastMode: false },
    })
    expect(resolveMothershipModelSettings({}, advanced)).toEqual({
      effort: 'medium',
      modelSelection: { model: 'gpt-6-astra', fastMode: false },
    })
  })

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'preserves the visible Plan effort %s with model selection hidden',
    (effort) => expect(resolveMothershipModelSettings({ effort }, false, true).effort).toBe(effort)
  )

  it('preserves an explicit Plan comparison choice when model selection is enabled', () => {
    const chosen = {
      effort: 'xhigh' as const,
      modelSelection: { model: 'gpt-6-astra' as const, fastMode: false },
    }
    expect(resolveMothershipModelSettings(chosen, true, true)).toEqual(chosen)
    expect(resolveMothershipModelSettings(chosen, false, true).modelSelection.model).toBe(
      'claude-opus-5-5'
    )
  })
})
