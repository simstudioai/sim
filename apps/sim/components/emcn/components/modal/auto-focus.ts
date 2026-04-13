/**
 * Default `onOpenAutoFocus` handler for emcn modals.
 *
 * Radix's native behavior focuses the first focusable descendant — usually the close
 * button in `ModalHeader`. We instead focus the first visible text-entry control
 * (input/textarea/contenteditable) inside the dialog, with the caret at the end.
 *
 * If no such control exists, we let Radix's default behavior run by not calling
 * `preventDefault()`.
 */

const TEXT_INPUT_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])' +
    ':not([type="button"]):not([type="submit"]):not([type="reset"])' +
    ':not([disabled]):not([readonly]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([readonly]):not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[contenteditable=""]:not([tabindex="-1"])',
].join(',')

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0
}

export function focusFirstTextInput(event: Event): void {
  const content = event.currentTarget as HTMLElement | null
  if (!content) return

  const target = Array.from(
    content.querySelectorAll<HTMLElement>(TEXT_INPUT_SELECTOR)
  ).find(isVisible)
  if (!target) return

  event.preventDefault()
  target.focus({ preventScroll: false })

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const end = target.value.length
    try {
      target.setSelectionRange(end, end)
    } catch {
      // Some input types (number, email, etc.) reject setSelectionRange — ignore.
    }
  } else if (target.isContentEditable) {
    const range = document.createRange()
    range.selectNodeContents(target)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }
}
