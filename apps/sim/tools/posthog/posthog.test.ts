import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import { PostHogBlock } from '@/blocks/blocks/posthog'
import * as posthogTools from '@/tools/posthog'
import type { ToolConfig } from '@/tools/types'

/** A 200 body every PostHog tool can read: a list page, a flag map, a capture status, a deletion. */
const SAMPLE_BODY = {
  id: 1,
  status: 1,
  count: 0,
  results: [],
  flags: {},
  next: null,
  persons_deleted: 1,
}

const tools = Object.entries(posthogTools as Record<string, ToolConfig>).filter(
  ([, tool]) => typeof tool?.transformResponse === 'function'
)

describe('posthog tool responses', () => {
  it('covers every PostHog tool', () => {
    expect(tools.length).toBeGreaterThanOrEqual(45)
  })

  it.each(tools)('%s returns a successful tool result for a 200 response', async (_, tool) => {
    const result = await tool.transformResponse?.(jsonResponse(SAMPLE_BODY), { batch: '[]' })
    expect(result?.success).toBe(true)
    expect(result?.output).toEqual(expect.any(Object))
  })
})

describe('posthog delete person', () => {
  it('reports a deletion PostHog queued as successful', async () => {
    const result = await posthogTools.posthogDeletePersonTool.transformResponse?.(
      jsonResponse({ persons_found: 1, persons_deleted: 0, persons_queued_for_deletion: 1 })
    )
    expect(result?.success).toBe(true)
  })
})

describe('posthog create feature flag rollout', () => {
  const buildBody = (rolloutPercentage: unknown) => {
    const body = posthogTools.posthogCreateFeatureFlagTool.request.body
    if (!body) throw new Error('create feature flag has no request body')
    return body({
      projectId: '1',
      region: 'us',
      apiKey: 'test-key',
      name: 'Beta',
      key: 'beta',
      rolloutPercentage: rolloutPercentage as number,
    }) as { filters?: { groups: { rollout_percentage: number }[] } }
  }

  it.each([null, undefined, '', '   '])('sends no release condition for %j', (value) => {
    expect(buildBody(value).filters).toBeUndefined()
  })

  it.each(['abc', '50%', 150, -5])('refuses the rollout %j', (value) => {
    expect(() => buildBody(value)).toThrow('Rollout percentage must be a number from 0 to 100')
  })

  it.each([
    ['30', 30],
    [' 30 ', 30],
    [30, 30],
    [0, 0],
    ['0', 0],
  ])('releases the flag to %j percent', (value, expected) => {
    expect(buildBody(value).filters?.groups).toEqual([
      { properties: [], rollout_percentage: expected },
    ])
  })
})

describe('posthog block rollout mapping', () => {
  const mapParams = (operation: string, rolloutPercentage: unknown) =>
    PostHogBlock.tools.config?.params?.({ operation, rolloutPercentage }) ?? {}

  it.each(['', '   ', '0', 0, null])(
    'leaves a create rollout of %j for the tool to read',
    (value) => {
      expect(mapParams('posthog_create_feature_flag', value)).not.toHaveProperty(
        'rolloutPercentage'
      )
    }
  )

  it('keeps sending update rollouts as before', () => {
    expect(mapParams('posthog_update_feature_flag', '30')).toEqual({ rolloutPercentage: 30 })
    expect(mapParams('posthog_update_feature_flag', 0)).toEqual({})
  })
})
