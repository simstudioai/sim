'use client'

import { memo, type ReactNode } from 'react'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { Streamdown } from 'streamdown'
import styles from '@/app/(product)/_components/markdown-content/markdown.module.css'
import { onExternalLinkClick } from '@/platform/lib/data/external-link'
import { extractTextContent } from '@/platform/lib/data/node-text'

const COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <p data-type='T048'>{children}</p>,
  h1: ({ children }: { children?: ReactNode }) => <h2 data-type='T074'>{children}</h2>,
  h2: ({ children }: { children?: ReactNode }) => <h3 data-type='T047'>{children}</h3>,
  h3: ({ children }: { children?: ReactNode }) => <h4 data-type='T047'>{children}</h4>,
  li: ({ children }: { children?: ReactNode }) => <li data-type='T048'>{children}</li>,
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a
      className={styles.link}
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      onClick={(event) => onExternalLinkClick(event, href)}
    >
      {children}
    </a>
  ),
  code: ({ children }: { children?: ReactNode }) => <code data-type='T009'>{children}</code>,
  pre: ({ children }: { children?: ReactNode }) => (
    <div className={styles.code}>
      <span className={styles.copy}>
        <CopyButton label='Copy code' text={extractTextContent(children)} />
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

/** Shared Platform rendering of formatted chat responses and skill instructions. */
export const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Streamdown components={COMPONENTS}>{text}</Streamdown>
    </div>
  )
})
