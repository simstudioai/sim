import type { KeyboardEvent } from 'react'

interface KeyboardActivationOptions {
  stopPropagation?: boolean
}

function isKeyboardActivation(event: KeyboardEvent) {
  return event.key === 'Enter' || event.key === ' '
}

export function handleKeyboardActivation(
  event: KeyboardEvent,
  action: () => void,
  options: KeyboardActivationOptions = {}
) {
  if (!isKeyboardActivation(event)) return

  event.preventDefault()

  if (options.stopPropagation) {
    event.stopPropagation()
  }

  action()
}
