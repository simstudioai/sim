'use client'

import { createContext, useContext } from 'react'

/** The level of a settings page's heading: `h1` where the page is the document, `h2` under a tab's own heading. */
export type SettingsHeadingLevel = 'h1' | 'h2'

interface SettingsPage {
  title: string
  description?: string
  headingLevel: SettingsHeadingLevel
  /** Names the page's region after whichever header it renders. */
  headingId: string
}

export const SettingsPageContext = createContext<SettingsPage | null>(null)

/**
 * The level and id of the heading a sub-view's header renders: the page's own when it sits in a
 * `SettingsBody`, an unnamed `h2` outside one.
 */
export function useSettingsHeading(): { level: SettingsHeadingLevel; id?: string } {
  const page = useContext(SettingsPageContext)
  return page ? { level: page.headingLevel, id: page.headingId } : { level: 'h2' }
}
