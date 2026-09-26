import { describe, expect, it } from 'vitest'
import { JotformBlock } from '@/blocks/blocks/jotform'

/**
 * Every assertion here runs against `{ ...inputs, ...buildParams(inputs) }`, the
 * shape the generic tool handler actually forwards. A key the mapper omits is
 * *not* dropped by that merge — the raw subBlock value survives — so asserting
 * on the mapper's return alone would prove nothing about what the tool receives.
 */
describe('JotformBlock', () => {
  const buildParams = JotformBlock.tools.config.params!

  /**
   * `create_form` and `create_questions` both feed a `questions` tool param from
   * different subblocks. A leftover value from one must not arrive as the other.
   */
  it('keeps the two questions sources from bleeding into each other', () => {
    const inputs = {
      operation: 'create_questions',
      apiKey: 'key',
      formId: '2315',
      bulkQuestions: '[{"type":"control_head"}]',
      newFormQuestions: '[{"type":"control_email"}]',
    }

    expect({ ...inputs, ...buildParams(inputs) }.questions).toBe(inputs.bulkQuestions)
  })
})
