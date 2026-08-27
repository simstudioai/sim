import { utf8ByteLength } from '@sim/utils/paste'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

export interface RichMarkdownPasteAdmissionOptions {
  maxResultBytes: number
  getCurrentText: () => string
  onRejected: () => void
}

/**
 * Rejects a paste before Markdown parsing when its projected document would leave the editor's
 * supported collaboration envelope. The selected ProseMirror text is subtracted from the current
 * Markdown size, so replacing a large selection is admitted instead of being treated as an append.
 */
export function createRichMarkdownPasteAdmission({
  maxResultBytes,
  getCurrentText,
  onRejected,
}: RichMarkdownPasteAdmissionOptions): Extension {
  return Extension.create({
    name: 'richMarkdownPasteAdmission',
    priority: 1_000,

    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              paste: (view, event) => {
                const pastedText = event.clipboardData?.getData('text/plain') ?? ''
                if (!pastedText) return false

                const currentText = getCurrentText()
                const { from, to } = view.state.selection
                const replacedText = view.state.doc.textBetween(from, to, '\n')
                const currentBytes = utf8ByteLength(currentText, maxResultBytes)
                const pastedBytes = utf8ByteLength(pastedText, maxResultBytes)
                const replacesWholeDocument = from <= 1 && to >= view.state.doc.content.size - 1
                const replacedBytes = replacesWholeDocument
                  ? currentBytes
                  : utf8ByteLength(replacedText, maxResultBytes)
                const projectedBytes = Math.max(0, currentBytes - replacedBytes) + pastedBytes
                if (projectedBytes <= maxResultBytes) return false

                event.preventDefault()
                onRejected()
                return true
              },
            },
          },
        }),
      ]
    },
  })
}
