import { describe, expect, it } from 'vitest'
import { RocketlaneBlock } from '@/blocks/blocks/rocketlane'

/** Runs the mapper the way a tool call does: model args merged under the mapper's result. */
function resolveToolCall(args: Record<string, unknown>, operation: string) {
  const mapper = RocketlaneBlock.tools.config?.params
  if (!mapper) throw new Error('Rocketlane block has no params mapper')
  return { ...args, ...mapper(args, { operation }) }
}

describe('RocketlaneBlock agent tool calls', () => {
  it('keeps and coerces the time source the model names when the operation arrives only in context', () => {
    const result = resolveToolCall(
      { apiKey: 'key', date: '2026-11-15', minutes: '30', projectId: '101' },
      'create_time_entry'
    )

    expect(result).toMatchObject({ date: '2026-11-15', minutes: 30, projectId: 101 })
    expect(result.taskId).toBeUndefined()
  })

  it('sends only the saved time source when the model also names a different one', () => {
    const result = resolveToolCall(
      {
        apiKey: 'key',
        date: '2026-11-15',
        minutes: '30',
        timeEntrySource: 'task',
        timeEntryTaskId: '42',
        projectId: '101',
      },
      'create_time_entry'
    )

    expect(result).toMatchObject({ taskId: 42 })
    expect(result.projectId).toBeUndefined()
  })
})

describe('RocketlaneBlock canvas mapping', () => {
  it('sends a text filter that a reference resolved to a number instead of dropping it', () => {
    const mapper = RocketlaneBlock.tools.config?.params
    if (!mapper) throw new Error('Rocketlane block has no params mapper')

    const result = mapper({
      operation: 'list_projects',
      apiKey: 'key',
      externalReferenceIdEquals: 42,
    })

    expect(result.externalReferenceIdEquals).toBe('42')
  })
})
