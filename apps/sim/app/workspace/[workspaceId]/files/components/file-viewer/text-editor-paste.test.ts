import { describe, expect, it } from 'vitest'
import { assessTextEditorPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor-paste'

describe('assessTextEditorPaste', () => {
  it('rejects an append that would exceed the saved file boundary', () => {
    expect(
      assessTextEditorPaste(
        {
          pastedText: '56789',
          currentText: '123456',
          selections: [{ start: 6, end: 6 }],
        },
        10
      )
    ).toEqual({ accepted: false, reason: 'result-bytes', actual: 11, limit: 10 })
  })

  it('projects one matching clipboard line per cursor in Monaco spread mode', () => {
    expect(
      assessTextEditorPaste(
        {
          pastedText: 'x\ny\n',
          currentText: '12345678',
          selections: [
            { start: 2, end: 2 },
            { start: 6, end: 6 },
          ],
        },
        10
      )
    ).toMatchObject({ accepted: true, resultBytes: 10 })
  })

  it('admits a distributed result when only removed line separators exceed the boundary', () => {
    expect(
      assessTextEditorPaste(
        {
          pastedText: 'a\nb\nc\nd\ne\nf',
          currentText: '1234',
          selections: [
            { start: 0, end: 0 },
            { start: 1, end: 1 },
            { start: 2, end: 2 },
            { start: 3, end: 3 },
            { start: 4, end: 4 },
            { start: 4, end: 4 },
          ],
        },
        10
      )
    ).toMatchObject({ accepted: true, resultBytes: 10 })
  })
})
