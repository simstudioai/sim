'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { ChipInput, Search } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
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

interface SettingsPanelSearch {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

interface SettingsPanelProps {
  /** Body content rendered below the header in the centered content column. */
  children: ReactNode
  /** Right-aligned controls in the fixed header bar (e.g. a Create/Invite chip). */
  actions?: ReactNode
  /** Overrides the nav-driven title (e.g. for a detail sub-view). */
  title?: string
  /** Overrides the nav-driven description. */
  description?: string
  /** Extra classes for the content column (layout/spacing only, e.g. a tighter `gap-*`). */
  contentClassName?: string
  /** Ref forwarded to the scroll region (e.g. for programmatic scroll-to-bottom). */
  scrollContainerRef?: React.Ref<HTMLDivElement>
  /**
   * Renders the canonical search field directly below the title. Omit on pages
   * with no search, or that pair search with extra controls (render that row in
   * `children` instead).
   */
  search?: SettingsPanelSearch
}

/**
 * Standard chrome for a settings page: a fixed header bar (right-aligned
 * `actions`), a scroll region, and a centered content column led by the page
 * title + description. The title/description come from the active section's
 * navigation metadata by default, and can be overridden for sub-views.
 *
 * Pages render only their body as `children`; they no longer hand-roll the
 * shell, header bar, or title block.
 */
export function SettingsPanel({
  children,
  actions,
  title,
  description,
  contentClassName,
  scrollContainerRef,
  search,
}: SettingsPanelProps) {
  const section = useSettingsSection()
  const meta = section ? getSettingsSectionMeta(section) : null
  const resolvedTitle = title ?? meta?.label
  const resolvedDescription = description ?? meta?.description

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <div />
        <div className='flex h-[30px] items-center gap-1'>{actions}</div>
      </div>
      <div
        ref={scrollContainerRef}
        className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'
      >
        <div
          className={cn('mx-auto flex w-full max-w-[48rem] flex-col gap-7 pb-6', contentClassName)}
        >
          {(resolvedTitle || resolvedDescription) && (
            <div className='flex flex-col gap-1'>
              {resolvedTitle && (
                <h1 className='font-medium text-[var(--text-body)] text-lg'>{resolvedTitle}</h1>
              )}
              {resolvedDescription && (
                <p className='text-[var(--text-muted)] text-md'>{resolvedDescription}</p>
              )}
            </div>
          )}
          {search && (
            <ChipInput
              icon={Search}
              placeholder={search.placeholder ?? 'Search...'}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              disabled={search.disabled}
              autoComplete='off'
              className='w-full'
            />
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
