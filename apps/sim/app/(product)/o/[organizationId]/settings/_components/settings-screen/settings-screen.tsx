'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { PageColumn } from '@sim/emcn-platform/page-column'
import { parseAsString, useQueryState } from 'nuqs'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/settings-screen/settings-screen.module.css'
import { SETTING_ROW_PARAM } from '@/platform/shared/settings-search'

const ROW_WAIT_MS = 4_000

/** A one-shot signal: nullable with no default, and stripped once answered. */
const settingRowParser = parseAsString.withOptions({ history: 'replace', scroll: false })

/**
 * Brings the row a Settings search result named into view once the section renders it, which may
 * be a chunk and a read away. The param is stripped when the row is found or the wait lapses,
 * because a conditional row may never come, and so a second click on the same result reveals it again.
 */
function useSettingRowReveal() {
  const [row, setRow] = useQueryState(SETTING_ROW_PARAM, settingRowParser)
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!row || !root) return
    const selector = `[data-setting-label="${CSS.escape(row)}"]`
    const observer = new MutationObserver(reveal)
    const timer = setTimeout(settle, ROW_WAIT_MS)
    function stop() {
      observer.disconnect()
      clearTimeout(timer)
    }
    function settle() {
      stop()
      void setRow(null)
    }
    function reveal() {
      const element = root?.querySelector(selector)
      if (!element) return
      element.scrollIntoView({ block: 'center' })
      settle()
    }
    observer.observe(root, { childList: true, subtree: true })
    reveal()
    return stop
  }, [row, setRow])
  return rootRef
}

interface SettingsScreenProps {
  title: string
  /** The page's one-line summary under its title, from the Settings navigation metadata. */
  description?: string
  children: ReactNode
}

export function SettingsScreen({ title, description, children }: SettingsScreenProps) {
  const start = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const content = useSettingRowReveal()
  useEffect(() => {
    const marker = start.current
    if (!marker) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(marker)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <div ref={start} className={styles.scrollStart} aria-hidden='true' />
      <header
        aria-label='Settings location'
        className={styles.breadcrumb}
        data-scrolled={scrolled || undefined}
      >
        <span className={styles.parent} data-type='T057'>
          Settings
        </span>
        <span aria-hidden='true' className={styles.parent} data-type='T057'>
          /
        </span>
        <span className={styles.fullTitle} data-type='T057'>
          {title}
        </span>
        <span className={styles.compactTitle} data-type='T042'>
          {title}
        </span>
      </header>
      <PageColumn>
        <main ref={content} className={styles.content}>
          <header className={styles.heading}>
            <h1 data-type='T076'>{title}</h1>
            {description && <p data-type='T067'>{description}</p>}
          </header>
          {children}
        </main>
      </PageColumn>
    </>
  )
}
