'use client'

import { createContext, type ReactNode, type Ref, useContext } from 'react'
import {
  type SettingsAction,
  type SettingsBackAction,
  type SettingsHeaderSearch,
  useSettingsHeader,
} from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import {
  getSettingsSectionMeta,
  type SettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'

const SettingsSectionContext = createContext<SettingsSection | null>(null)

/**
 * Provides the active settings section to descendants so `SettingsPanel` can
 * resolve its title/description from navigation metadata. Set once by the
 * settings shell with the resolved (post-redirect) section.
 */
export function SettingsSectionProvider({
  section,
  children,
}: {
  section: SettingsSection
  children: ReactNode
}) {
  return (
    <SettingsSectionContext.Provider value={section}>{children}</SettingsSectionContext.Provider>
  )
}

function useSettingsSection(): SettingsSection | null {
  return useContext(SettingsSectionContext)
}

interface SettingsPanelProps {
  /** Body content rendered below the header in the centered content column. */
  children: ReactNode
  /** Strict top-right action chips — data only (`text`/`icon`/`variant`/…), never JSX. */
  actions?: SettingsAction[]
  /** Left-aligned back chip for a detail sub-view; omit on list/panel pages. */
  back?: SettingsBackAction
  /** Renders the canonical search field directly below the title. */
  search?: SettingsHeaderSearch
  /** Overrides the nav-driven title (e.g. for a detail sub-view). */
  title?: string
  /** Overrides the nav-driven description. */
  description?: string
  /** Overrides the nav-driven docs link (the "Docs" link rendered in the header bar). */
  docsLink?: string
  /** Escape hatch for a right-aligned widget that genuinely cannot be a chip. Rare. */
  aside?: ReactNode
  /** Forwarded to the scroll region (e.g. for programmatic scroll-to-bottom). */
  scrollContainerRef?: Ref<HTMLDivElement>
}

/**
 * Registers a settings section's header content (title, description, docs link,
 * action chips, search) into the persistent settings layout, then renders the
 * section body. It owns **no** chrome: the header bar, scroll region, centered
 * column, and spacing all live in the layout's `SettingsHeaderShell` and stay
 * mounted across section navigation. Sections supply data only — the structured
 * `actions` contract makes it impossible to inject a `<div>` or a padding change.
 */
export function SettingsPanel({
  children,
  actions,
  back,
  search,
  title,
  description,
  docsLink,
  aside,
  scrollContainerRef,
}: SettingsPanelProps) {
  const section = useSettingsSection()
  const meta = section ? getSettingsSectionMeta(section) : null

  useSettingsHeader({
    title: title ?? meta?.label,
    description: description ?? meta?.description,
    docsLink: docsLink ?? meta?.docsLink,
    back,
    actions,
    search,
    aside,
    scrollContainerRef,
  })

  return <>{children}</>
}
