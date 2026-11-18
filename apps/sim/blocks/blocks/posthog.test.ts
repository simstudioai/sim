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

/** Executes `operation` with every field it shows seeded the way an API-built block seeds it. */
function seededExecutionParams(operation: string) {
  const params: Record<string, unknown> = { operation }
  for (const subBlock of PostHogBlock.subBlocks) {
    const condition = typeof subBlock.condition === 'function' ? undefined : subBlock.condition
    const shown = condition?.field === 'operation' && [condition.value].flat().includes(operation)
    const seeded = shown ? subBlock.value?.({ operation }) : undefined
    if (seeded !== undefined) params[subBlock.id] = seeded
  }
  return executionParams(params)
}

describe('PostHogBlock create-only defaults', () => {
  it('sends the create defaults on create', () => {
    expect(seededExecutionParams('posthog_create_feature_flag')).toMatchObject({
      active: true,
      ensureExperienceContinuity: false,
    })
    expect(seededExecutionParams('posthog_create_cohort')).toMatchObject({ is_static: false })
  })

  it('leaves an untouched field out of an update, so it keeps what PostHog stores', () => {
    const flag = seededExecutionParams('posthog_update_feature_flag')
    expect([flag.active, flag.ensureExperienceContinuity]).toEqual([undefined, undefined])
    const cohort = seededExecutionParams('posthog_update_cohort')
    expect([cohort.isStatic, cohort.is_static]).toEqual([undefined, undefined])
  })
})

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
        executionParams({ operation: 'posthog_update_cohort', isStatic: stored, deleted: stored })
      ).toMatchObject({ isStatic: expected, deleted: expected })
      expect(
        executionParams({ operation: 'posthog_update_insight', favorited: stored })
      ).toMatchObject({ favorited: expected })
      expect(
        executionParams({ operation: 'posthog_create_dashboard', pinned: stored })
      ).toMatchObject({ pinned: expected })
      for (const operation of ['posthog_update_experiment', 'posthog_update_survey']) {
        expect(executionParams({ operation, archived: stored })).toMatchObject({
          archived: expected,
        })
      }
    }
  })

  it('leaves an untouched switch out of the request', () => {
    const params = executionParams({ operation: 'posthog_update_cohort' })
    expect(params).not.toHaveProperty('deleted')
    expect(params).not.toHaveProperty('isStatic')
  })
})
