'use client'

import { memo, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import styles from '@/platform/app/(shell)/_components/chat/message/markdown.module.css'
import { CopyButton } from '@/platform/design-system/components'
import { nodeText } from '@/platform/lib/data/node-text'

const COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <p data-type='T048'>{children}</p>,
  h1: ({ children }: { children?: ReactNode }) => <h2 data-type='T074'>{children}</h2>,
  h2: ({ children }: { children?: ReactNode }) => <h3 data-type='T047'>{children}</h3>,
  h3: ({ children }: { children?: ReactNode }) => <h4 data-type='T047'>{children}</h4>,
  li: ({ children }: { children?: ReactNode }) => <li data-type='T048'>{children}</li>,
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a className={styles.link} href={href} target='_blank' rel='noopener noreferrer'>
      {children}
    </a>
  ),
  code: ({ children }: { children?: ReactNode }) => <code data-type='T009'>{children}</code>,
  pre: ({ children }: { children?: ReactNode }) => (
    <div className={styles.code}>
      <span className={styles.copy}>
        <CopyButton label='Copy code' text={nodeText(children)} />
      </span>
      <pre>{children}</pre>
    </div>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className={styles.table} role='region' aria-label='Table'>
      <table>{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => <th data-type='T047'>{children}</th>,
  td: ({ children }: { children?: ReactNode }) => <td data-type='T048'>{children}</td>,
}

/**
 * Assistant prose. `streamdown` is the parser legacy reads with, so an unfinished code fence or
 * link mid-stream settles the same way; everything visible is this owner's elements and tokens.
 */
export const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Streamdown components={COMPONENTS}>{text}</Streamdown>
    </div>
  )
})
