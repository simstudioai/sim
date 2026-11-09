import type { KeyboardEvent } from 'react'

/** Runs `action` on Enter or Space, as a native button would, for the card's role=button parts. */
export function handleKeyboardActivation(event: KeyboardEvent, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}
