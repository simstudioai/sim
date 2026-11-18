import { describe, expect, it } from 'vitest'
import { PostHogBlock } from '@/blocks/blocks/posthog'

/** Serializes then executes the block the way the generic handler does. */
function executionParams(params: Record<string, unknown>) {
  const { tool, params: mapParams } = PostHogBlock.tools.config ?? {}
  if (!tool || !mapParams) throw new Error('PostHog block has no tool config')
  const serialized = { ...params }
  tool(serialized)
  return { ...serialized, ...mapParams(serialized) }
}

describe('PostHogBlock switch values', () => {
  it('sends the text form older workflows store as the same booleans as the real form', () => {
    for (const [stored, expected] of [
      ['false', false],
      ['true', true],
      [false, false],
      [true, true],
    ] as const) {
      expect(
        executionParams({
          operation: 'posthog_update_feature_flag',
          active: stored,
          ensureExperienceContinuity: stored,
        })
      ).toMatchObject({ active: expected, ensureExperienceContinuity: expected })
      expect(
        executionParams({ operation: 'posthog_create_cohort', isStatic: stored })
      ).toMatchObject({ is_static: expected })
      expect(
        executionParams({ operation: 'posthog_update_cohort', isStatic: stored })
      ).toMatchObject({ isStatic: expected })
    }
  })
})
