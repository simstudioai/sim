'use client'

import { createContext, type ReactNode, useContext, useEffect, useId, useRef } from 'react'
import { parseAsString, useQueryState } from 'nuqs'
import styles from '@/app/(product)/_components/settings-parts/settings-page.module.css'
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

/** The level of a settings page's heading: `h1` where the page is the document, `h2` under a tab's own heading. */
export type SettingsHeadingLevel = 'h1' | 'h2'

interface SettingsPage {
  title: string
  description?: string
  headingLevel: SettingsHeadingLevel
  /** Names the page's region after whichever header it renders. */
  headingId: string
}

const SettingsPageContext = createContext<SettingsPage | null>(null)

/**
 * The level and id of the heading a sub-view's header renders: the page's own when it sits in a
 * {@link SettingsBody}, an unnamed `h2` outside one.
 */
export function useSettingsHeading(): { level: SettingsHeadingLevel; id?: string } {
  const page = useContext(SettingsPageContext)
  return page ? { level: page.headingLevel, id: page.headingId } : { level: 'h2' }
}

interface SettingsBodyProps {
  title: string
  /** The page's one-line summary under its title, from the Settings navigation metadata. */
  description?: string
  headingLevel: SettingsHeadingLevel
  children: ReactNode
}

/**
 * The one body every settings page, organization or workspace, renders in: Paper's settings column,
 * the reveal of a row a Settings search result named, and the page's title and description for
 * the open section's {@link SettingsPageHeader}. The body draws no heading of its own: the section
 * renders exactly one header, the page's or a sub-view's `DetailHeader`, so a sub-view never stacks
 * under the page title. The surrounding chrome (breadcrumb, tab bar, navigation) stays outside.
 */
export function SettingsBody({ title, description, headingLevel, children }: SettingsBodyProps) {
  const headingId = useId()
  const reveal = useSettingRowReveal()
  return (
    <SettingsPageContext.Provider value={{ title, description, headingLevel, headingId }}>
      <section ref={reveal} className={styles.body} aria-labelledby={headingId}>
        {children}
      </section>
    </SettingsPageContext.Provider>
  )
}

/**
 * The page's title and description, as its navigation entry names them. A section renders it in
 * its main view and a sub-view renders `DetailHeader` instead, so the page has one header. Outside a
 * {@link SettingsBody} there is no page to name, so it renders nothing.
 */
export function SettingsPageHeader() {
  const page = useContext(SettingsPageContext)
  if (!page) return null
  return (
    <header className={styles.header}>
      {page.headingLevel === 'h1' ? (
        <h1 id={page.headingId} data-type='T076'>
          {page.title}
        </h1>
      ) : (
        <h2 id={page.headingId} data-type='T076'>
          {page.title}
        </h2>
      )}
      {page.description && <p data-type='T067'>{page.description}</p>}
    </header>
  )
}
