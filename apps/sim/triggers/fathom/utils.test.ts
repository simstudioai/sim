import { describe, expect, it } from 'vitest'
import type { OutputSchema } from '@/executor/utils/block-reference'
import { isPathInSchema } from '@/executor/utils/block-reference'
import { buildMeetingOutputs } from '@/triggers/fathom/utils'

describe('Fathom meeting trigger outputs', () => {
  const schema = buildMeetingOutputs() as unknown as OutputSchema

  it('resolves the documented recorder and summary fields', () => {
    expect(isPathInSchema(schema, ['recorded_by', 'team'])).toBe(true)
    expect(isPathInSchema(schema, ['default_summary', 'markdown_formatted'])).toBe(true)
  })

  it('keeps accepting sub-paths saved before the fields were declared', () => {
    expect(isPathInSchema(schema, ['recorded_by', 'id'])).toBe(true)
    expect(isPathInSchema(schema, ['default_summary', 'sections'])).toBe(true)
  })
})
