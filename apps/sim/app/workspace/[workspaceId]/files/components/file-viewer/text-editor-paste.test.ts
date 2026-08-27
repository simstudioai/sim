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

  it('admits replacing a selection at the boundary', () => {
    expect(
      assessTextEditorPaste(
        {
          pastedText: '56789',
          currentText: '123456',
          selections: [{ start: 1, end: 6 }],
        },
        6
      )
    ).toMatchObject({ accepted: true, resultBytes: 6 })
  })

  it('projects the clipboard text at every Monaco cursor', () => {
    expect(
      assessTextEditorPaste(
        {
          pastedText: 'xy',
          currentText: '12345678',
          selections: [
            { start: 2, end: 2 },
            { start: 6, end: 6 },
          ],
        },
        10
      )
    ).toMatchObject({ accepted: false, reason: 'result-bytes', limit: 10 })
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

  it('projects the full clipboard at every cursor when Monaco spread mode is disabled', () => {
    expect(
      assessTextEditorPaste(
        {
          pastedText: 'x\ny',
          currentText: '123456',
          selections: [
            { start: 2, end: 2 },
            { start: 4, end: 4 },
          ],
          multiCursorPaste: 'full',
        },
        10
      )
    ).toMatchObject({ accepted: false, reason: 'result-bytes', limit: 10 })
  })
})
