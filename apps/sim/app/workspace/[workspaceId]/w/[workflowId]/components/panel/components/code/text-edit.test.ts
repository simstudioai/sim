import { describe, expect, it } from 'vitest'
import {
  minimalTextEdit,
  type TextEdit,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/code/text-edit'

function apply(before: string, edit: TextEdit | null): string {
  if (!edit) return before
  return before.slice(0, edit.start) + edit.text + before.slice(edit.end)
}

describe('minimalTextEdit', () => {
  it('returns null for identical text', () => {
    expect(minimalTextEdit('const a = 1\n', 'const a = 1\n')).toBeNull()
  })

  it('replaces only the changed range of a long file', () => {
    const head = 'line\n'.repeat(10_000)
    const tail = 'other\n'.repeat(10_000)
    const edit = minimalTextEdit(`${head}return 40 + 2\n${tail}`, `${head}return 6 * 7\n${tail}`)
    expect(edit).toEqual({ start: head.length + 7, end: head.length + 13, text: '6 * 7' })
  })

  it('never counts a character into both the prefix and the suffix', () => {
    expect(minimalTextEdit('aa', 'aaa')).toEqual({ start: 2, end: 2, text: 'a' })
    expect(minimalTextEdit('aaa', 'aa')).toEqual({ start: 2, end: 3, text: '' })
    expect(minimalTextEdit('abab', 'ab')).toEqual({ start: 2, end: 4, text: '' })
  })

  it('keeps a changed surrogate pair whole', () => {
    const edit = minimalTextEdit('x😀y', 'x😁y')
    expect(edit).toEqual({ start: 1, end: 3, text: '😁' })
    // U+1F600 and U+1FA00 share their low surrogate, so only the high one differs.
    expect(minimalTextEdit('x\u{1F600}', 'x\u{1FA00}')).toEqual({
      start: 1,
      end: 3,
      text: '\u{1FA00}',
    })
    const removed = minimalTextEdit('😀😀', '😀')
    expect(removed?.start).toBe(2)
    expect(removed?.end).toBe(4)
  })

  it('turns the old text into the new one for every pair of a small alphabet', () => {
    const words = ['', 'a', 'b', 'ab', 'ba', 'aab', 'abb', 'aba', '😀', 'a😀', '😀a', '😁😀']
    for (const before of words) {
      for (const after of words) {
        const edit = minimalTextEdit(before, after)
        expect(apply(before, edit)).toBe(after)
        if (edit) {
          expect(edit.start).toBeLessThanOrEqual(edit.end)
          expect(edit.end - edit.start + edit.text.length).toBeLessThanOrEqual(
            before.length + after.length
          )
        }
      }
    }
  })
})
