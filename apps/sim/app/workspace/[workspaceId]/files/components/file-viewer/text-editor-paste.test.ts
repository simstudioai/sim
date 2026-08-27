import { describe, expect, it } from 'vitest'
import { assessTextEditorPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor-paste'

describe('assessTextEditorPaste', () => {
  it('rejects an append that would exceed the saved file boundary', () => {
    expect(
      assessTextEditorPaste(
        {
          pastedText: '56789',
          currentText: '123456',
          selectionStart: 6,
          selectionEnd: 6,
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
          selectionStart: 1,
          selectionEnd: 6,
        },
        6
      )
    ).toMatchObject({ accepted: true, resultBytes: 6 })
  })
})
