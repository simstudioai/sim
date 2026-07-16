/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isElseConditionTitle } from '@/lib/workflows/conditions'

describe('isElseConditionTitle', () => {
  it.each(['else', 'Else', ' \t eLsE \n'])('recognizes "%s" as an else title', (title) => {
    expect(isElseConditionTitle(title)).toBe(true)
  })

  it('rejects other condition titles', () => {
    expect(isElseConditionTitle('else if')).toBe(false)
  })

  it('does not mutate legacy snapshot titles', () => {
    const condition = { title: ' Else ' }

    isElseConditionTitle(condition.title)

    expect(condition.title).toBe(' Else ')
  })
})
