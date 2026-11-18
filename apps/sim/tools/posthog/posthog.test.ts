import { describe, expect, it } from 'vitest'
import * as posthogTools from '@/tools/posthog'
import type { ToolConfig } from '@/tools/types'

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

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
    const result = await tool.transformResponse?.(okJson(SAMPLE_BODY), { batch: '[]' })
    expect(result?.success).toBe(true)
    expect(result?.output).toEqual(expect.any(Object))
  })
})

describe('posthog delete person', () => {
  it('reports a deletion PostHog queued as successful', async () => {
    const result = await posthogTools.posthogDeletePersonTool.transformResponse?.(
      okJson({ persons_found: 1, persons_deleted: 0, persons_queued_for_deletion: 1 })
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

  it.each([null, '', '   ', 'abc', 150])('sends no release condition for %j', (value) => {
    expect(buildBody(value).filters).toBeUndefined()
  })

  it.each([
    ['30', 30],
    [30, 30],
    [0, 0],
  ])('releases the flag to %j percent', (value, expected) => {
    expect(buildBody(value).filters?.groups).toEqual([
      { properties: [], rollout_percentage: expected },
    ])
  })
})
