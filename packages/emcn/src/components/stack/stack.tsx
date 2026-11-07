import type { ReactElement } from 'react'
import styles from '#emcn/components/stack/stack.module.css'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

interface StackProps {
  items: readonly { id: string; label: string; content: ReactElement }[]
  total?: number
  label?: string
}

const compactCount = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** A compact visual roster; the remaining count is text, not another interaction. */
export function Stack({ items, total = items.length, label }: StackProps) {
  const visible = items.slice(0, 3)
  const remaining = Math.max(0, total - visible.length)
  if (!visible.length && !remaining) return null
  return (
    <span className={styles.stack} role='group' aria-label={label}>
      {visible.map((item) => (
        <span key={item.id} className={styles.item}>
          <Tooltip label={item.label}>{item.content}</Tooltip>
        </span>
      ))}
      {remaining > 0 && (
        <span
          className={styles.count}
          data-type='T052'
          aria-label={`${remaining} ${remaining === 1 ? 'other' : 'others'}`}
        >
          +{compactCount.format(remaining).replace(/K$/, 'k')}
        </span>
      )}
    </span>
  )
}
