'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Duplicate, Tooltip } from '@sim/emcn'
import { CHAT_ACTION_BUTTON_CLASS, CHAT_ACTION_ICON_CLASS } from '@/components/chat/turn-layout'

/** How long the button stays in its confirmed state after a copy. */
const COPIED_RESET_MS = 1500

export interface ChatCopyButtonProps {
  /** Text placed on the clipboard. An empty value renders nothing. */
  content: string
}

/**
 * Copies an assistant turn to the clipboard.
 *
 * Wears the shared per-message action chrome ({@link CHAT_ACTION_BUTTON_CLASS}),
 * which the Sim chat's own action row wears too, so a chat module and the Sim
 * chat cannot drift on icon, size, hover treatment, or wording.
 */
export function ChatCopyButton({ content }: ChatCopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimeoutRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current)
    },
    []
  )

  if (!content) return null

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          aria-label='Copy message'
          onClick={copyToClipboard}
          className={CHAT_ACTION_BUTTON_CLASS}
        >
          {copied ? (
            <Check className={CHAT_ACTION_ICON_CLASS} />
          ) : (
            <Duplicate className={CHAT_ACTION_ICON_CLASS} />
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{copied ? 'Copied message' : 'Copy message'}</Tooltip.Content>
    </Tooltip.Root>
  )
}
