import {
  assessTextPaste,
  PASTE_LIMITS,
  type TextPasteAdmission,
  utf8ByteLength,
} from '@sim/utils/paste'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { postProcessSerializedMarkdown } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'

export interface RichMarkdownPasteAdmissionOptions {
  maxResultBytes: number
  getCurrentText: () => string
  onRejected: () => void
}

interface RawMarkdownPasteInput {
  pastedText: string
  currentText: string
  selectionStart: number
  selectionEnd: number
}

/** Applies the rich-document boundary to a projected raw-text paste result. */
export function assessRawMarkdownPaste(
  input: RawMarkdownPasteInput,
  maxResultBytes = PASTE_LIMITS.RICH_MARKDOWN_BYTES
): TextPasteAdmission {
  return assessTextPaste({ ...input, maxResultBytes })
}

/**
 * Rejects oversized clipboard representations before parsing, then filters the exact canonical
 * Markdown transaction before it can leave the editor's supported collaboration envelope. The early
 * plain-text projection subtracts the selected content, so a large replacement remains fast and is
 * not treated as an append.
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
      const { editor } = this
      let pasteInProgress = false

      return [
        new Plugin({
          filterTransaction: (transaction) => {
            const isPaste = pasteInProgress || transaction.getMeta('uiEvent') === 'paste'
            if (!isPaste || !transaction.docChanged) return true
            pasteInProgress = false

            if (!editor.markdown) {
              throw new Error('Rich Markdown paste admission requires the Markdown extension')
            }
            const projectedMarkdown = postProcessSerializedMarkdown(
              editor.markdown.serialize(transaction.doc.toJSON())
            )
            if (utf8ByteLength(projectedMarkdown, maxResultBytes) <= maxResultBytes) return true

            onRejected()
            return false
          },
          props: {
            handleDOMEvents: {
              paste: (view, event) => {
                const pastedText = event.clipboardData?.getData('text/plain') ?? ''
                const pastedHtml = event.clipboardData?.getData('text/html') ?? ''
                if (!pastedText && !pastedHtml) return false

                if (pastedHtml && utf8ByteLength(pastedHtml, maxResultBytes) > maxResultBytes) {
                  event.preventDefault()
                  onRejected()
                  return true
                }

                if (pastedText) {
                  const currentText = getCurrentText()
                  const { from, to } = view.state.selection
                  const replacedText = view.state.doc.textBetween(from, to, '\n')
                  const replacesWholeDocument = from <= 1 && to >= view.state.doc.content.size - 1
                  const projectedCharacters = replacesWholeDocument
                    ? pastedText.length
                    : Math.max(0, currentText.length - replacedText.length) + pastedText.length

                  if (projectedCharacters > Math.floor(maxResultBytes / 3)) {
                    const currentBytes = utf8ByteLength(currentText, maxResultBytes)
                    const pastedBytes = utf8ByteLength(pastedText, maxResultBytes)
                    const replacedBytes = replacesWholeDocument
                      ? currentBytes
                      : utf8ByteLength(replacedText, maxResultBytes)
                    const projectedBytes = Math.max(0, currentBytes - replacedBytes) + pastedBytes
                    if (projectedBytes > maxResultBytes) {
                      event.preventDefault()
                      onRejected()
                      return true
                    }
                  }
                }

                pasteInProgress = true
                queueMicrotask(() => {
                  pasteInProgress = false
                })
                return false
              },
            },
          },
        }),
      ]
    },
  })
}
