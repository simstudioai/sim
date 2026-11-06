import type { ReactNode, RefObject } from 'react'
import type { ComposerMark } from '@/platform/design-system/components/composer-input/composer-input'
import styles from '@/platform/design-system/components/composer-input/composer-input.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'

interface MarkedTextProps {
  text: string
  marks: readonly ComposerMark[]
  anchorOffset?: number
  caretAnchorRef?: RefObject<HTMLSpanElement | null>
}

export function MarkedText({ text, marks, anchorOffset, caretAnchorRef }: MarkedTextProps) {
  const runs: ReactNode[] = []
  let cursor = 0

  function addText(end: number) {
    if (anchorOffset !== undefined && anchorOffset >= cursor && anchorOffset < end) {
      runs.push(
        text.slice(cursor, anchorOffset),
        <span key='anchor' ref={caretAnchorRef}>
          {text[anchorOffset]}
        </span>
      )
      cursor = anchorOffset + 1
    }
    if (end > cursor) runs.push(text.slice(cursor, end))
    cursor = end
  }

  for (const { start, end, providerId, icon } of marks) {
    addText(start)
    runs.push(
      <span key={start} className={styles.mark}>
        <span className={styles.trigger} data-trigger={text[start]}>
          <span className={styles.hidden}>{text[start]}</span>
          {providerId ? <Icon providerId={providerId} /> : <Icon name={icon} />}
        </span>
        {text.slice(start + 1, end)}
      </span>
    )
    cursor = end
  }
  addText(text.length)
  if (anchorOffset === text.length)
    runs.push(
      <span key='anchor' ref={caretAnchorRef}>
        {'\u200b'}
      </span>
    )
  return (
    <div
      className={styles.mirror}
      aria-hidden='true'
      data-type='T048'
      data-measuring={!marks.length || undefined}
    >
      {runs}
    </div>
  )
}
