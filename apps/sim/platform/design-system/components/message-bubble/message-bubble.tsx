import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/message-bubble/message-bubble.module.css'

interface MessageBubbleProps {
  children: ReactNode
  onSelect?: () => void
  label?: string
}

export function MessageBubble({ children, onSelect, label }: MessageBubbleProps) {
  return onSelect ? (
    <button
      type='button'
      className={styles.bubble}
      data-type='T048'
      aria-label={label}
      onClick={onSelect}
    >
      {children}
    </button>
  ) : (
    <p className={styles.bubble} data-type='T048'>
      {children}
    </p>
  )
}
