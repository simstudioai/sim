/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { LogsV2Block } from '@/blocks/blocks/logs'

function buildQueryParams(params: Record<string, unknown>) {
  return LogsV2Block.tools.config!.params!({ operation: 'query', ...params })
}

describe('LogsV2Block trigger filter', () => {
  it('omits triggers when the filter is untouched, leaving pre-existing queries unfiltered', () => {
    expect(buildQueryParams({}).triggers).toBeUndefined()
    expect(buildQueryParams({ triggers: [] }).triggers).toBeUndefined()
    expect(buildQueryParams({ triggers: '' }).triggers).toBeUndefined()
  })

  it('joins a multi-select selection into the comma-separated list the API expects', () => {
    expect(buildQueryParams({ triggers: ['api', 'schedule'] }).triggers).toBe('api,schedule')
  })

  it('flattens a merged option id so one label can select several trigger values', () => {
    expect(buildQueryParams({ triggers: ['api', 'copilot,mothership'] }).triggers).toBe(
      'api,copilot,mothership'
    )
  })

  it('accepts an advanced-mode string of provider ids', () => {
    expect(buildQueryParams({ triggers: ' slack,gmail ' }).triggers).toBe('slack,gmail')
  })

  it('trims each hand-typed entry, not just the ends of the string', () => {
    // The filters split on commas without trimming, so a surviving space would
    // match no stored trigger and silently narrow the result set to nothing.
    expect(buildQueryParams({ triggers: 'api, schedule, slack' }).triggers).toBe(
      'api,schedule,slack'
    )
    expect(buildQueryParams({ triggers: 'api,,schedule,' }).triggers).toBe('api,schedule')
    expect(buildQueryParams({ triggers: ' , ' }).triggers).toBeUndefined()
  })

  it('trims entries inside a multi-select selection too', () => {
    expect(buildQueryParams({ triggers: ['api ', ' copilot, mothership'] }).triggers).toBe(
      'api,copilot,mothership'
    )
  })

  it('never sends triggers on the run-details operation', () => {
    expect(
      LogsV2Block.tools.config!.params!({
        operation: 'get_run_details',
        runId: 'run-1',
        triggers: ['api'],
      })
    ).toEqual({ runId: 'run-1' })
  })
})

describe('LogsV2Block backwards compatibility', () => {
  // `joinIds` is shared with the pre-existing workflow and status filters, so the
  // per-entry trimming added for hand-typed triggers must not move their output.
  // Every value a stored multi-select or advanced field can hold is listed here:
  // option ids and workflow ids contain neither spaces nor commas.
  const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

  it.each([
    ['unset', undefined, undefined],
    ['empty selection', [], undefined],
    ['one workflow', [UUID], UUID],
    [
      'two workflows',
      [UUID, 'b7a1c2d3-0000-4000-8000-000000000001'],
      `${UUID},b7a1c2d3-0000-4000-8000-000000000001`,
    ],
    ['advanced string', 'id-one,id-two', 'id-one,id-two'],
    ['empty string', '', undefined],
  ])('leaves workflowIds untouched for %s', (_name, value, expected) => {
    expect(buildQueryParams({ workflowIds: value }).workflowIds).toBe(expected)
  })

  it.each([
    ['unset', undefined, undefined],
    ['empty selection', [], undefined],
    ['one status', ['info'], 'info'],
    ['several statuses', ['info', 'error', 'cancelled'], 'info,error,cancelled'],
  ])('leaves level untouched for %s', (_name, value, expected) => {
    expect(buildQueryParams({ level: value }).level).toBe(expected)
  })

  it('omits triggers entirely for a block saved before the filter existed', () => {
    const params = buildQueryParams({ workflowIds: [UUID], level: ['info'] })
    expect(params.triggers).toBeUndefined()
    // Undefined values are dropped on serialization, so nothing reaches the query.
    expect(JSON.stringify(params)).not.toContain('triggers')
  })
})

describe('LogsV2Block trigger subblocks', () => {
  const subBlockIds = LogsV2Block.subBlocks.map((subBlock) => subBlock.id)

  it('declares triggers as the string it is transformed into', () => {
    // The generic handler JSON.parses any post-transform input declared 'array' or
    // 'json', so declaring the joined string as an array would warn on every run
    // and would turn JSON-looking advanced input into an array the tool rejects.
    expect(LogsV2Block.inputs.triggers.type).toBe('string')
    expect(typeof buildQueryParams({ triggers: ['api', 'schedule'] }).triggers).toBe('string')
  })

  it('exposes basic and advanced modes behind one canonical param', () => {
    expect(subBlockIds).toContain('triggerSelector')
    expect(subBlockIds).toContain('manualTriggers')

    for (const id of ['triggerSelector', 'manualTriggers']) {
      const subBlock = LogsV2Block.subBlocks.find((candidate) => candidate.id === id)
      expect(subBlock?.canonicalParamId).toBe('triggers')
      expect(subBlock?.condition).toEqual({ field: 'operation', value: 'query' })
    }
  })
})
