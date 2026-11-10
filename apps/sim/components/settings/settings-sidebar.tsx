'use client'

import { useRef } from 'react'
import {
  Chip,
  chipContentIconClass,
  chipVariants,
  cn,
  OverflowText,
  SimWordmark,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn-legacy'
import { ChevronLeft } from '@sim/emcn-legacy/icons'
import { useRouter } from 'next/navigation'
import {
  SETTINGS_PLANE_CHROME,
  type SettingsNavigationItem,
  type SettingsPlane,
  type SettingsSection,
} from '@/components/settings/navigation'
import { SettingsIntentLink } from '@/components/settings/settings-intent-link'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_RAIL_CHIP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/components/settings/sidebar-layout'
import { SidebarSection } from '@/components/settings/sidebar-section'
import { usePendingSettingsSelection } from '@/components/settings/use-pending-settings-selection'
import { APP_ENTRY_PATH, LANDING_HREF } from '@/lib/navigation/paths'
import { popSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface SettingsNavigationGroup {
  key: string
  title: string
}

interface SettingsSidebarProps<Section extends SettingsSection> {
  activeSection: string
  plane: SettingsPlane
  groups: readonly SettingsNavigationGroup[]
  hrefForSection: (section: Section) => string
  items: readonly SettingsNavigationItem<Section>[]
}

export function SettingsSidebar<Section extends SettingsSection>({
  activeSection,
  plane,
  groups,
  hrefForSection,
  items,
}: SettingsSidebarProps<Section>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { activeSection: selectedSection, navigateToSection } =
    usePendingSettingsSelection(activeSection)

  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const scrollEdges = useScrollEdges(scrollContainerRef, { contentRef: scrollContentRef })

  return (
    <>
      {/* The divider is the pinned block's bottom rule, not the scroll region's top one:
          the region's edge fade masks its own first pixels, which would erase a rule
          drawn there exactly when it should show. Same construction as the footer. */}
      <div
        className={cn(
          SIDEBAR_ITEM_GAP_CLASS,
          SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
          'flex shrink-0 flex-col border-b px-2 transition-colors duration-150',
          !scrollEdges.top && 'border-transparent'
        )}
      >
        {/* Both stay buttons, not Links: leaving settings must run the unsaved-changes guard. */}
        {SETTINGS_PLANE_CHROME[plane].showWordmark ? (
          <button
            type='button'
            aria-label='Sim home'
            onClick={() => requestLeave(() => router.push(LANDING_HREF))}
            className='flex h-[30px] shrink-0 items-center px-2 transition-opacity hover:opacity-70'
          >
            <SimWordmark />
          </button>
        ) : (
          <Chip
            fullWidth
            leftIcon={ChevronLeft}
            className={SIDEBAR_RAIL_CHIP_CLASS}
            onClick={() => requestLeave(() => router.push(popSettingsReturnUrl(APP_ENTRY_PATH)))}
          >
            <span className='sidebar-collapse-hide'>Back</span>
          </Chip>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        className={cn(
          SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
          SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
          scrollFadeClass,
          'flex flex-1 flex-col overflow-y-auto overflow-x-hidden'
        )}
        {...scrollFadeAttributes(scrollEdges)}
      >
        <div ref={scrollContentRef} className='flex flex-col'>
          {groups
            .map((group) => ({
              ...group,
              items: items.filter((item) => item.group === group.key),
            }))
            .filter((group) => group.items.length > 0)
            .map((group, index) => (
              <SidebarSection
                key={group.key}
                title={group.title}
                className={cn(index > 0 && SIDEBAR_SECTION_GAP_CLASS, 'shrink-0')}
              >
                <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = selectedSection === item.id
                    const href = hrefForSection(item.id)
                    return (
                      <SettingsIntentLink
                        key={item.id}
                        data-settings-navigation='managed'
                        href={href}
                        replace
                        scroll={false}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          chipVariants({ active, fullWidth: true }),
                          SIDEBAR_RAIL_CHIP_CLASS
                        )}
                        onNavigate={(event) => {
                          if (active) {
                            event.preventDefault()
                            return
                          }
                          event.preventDefault()
                          const { isDirty, navigationBlocked } = useSettingsDirtyStore.getState()
                          if (!isDirty && !navigationBlocked) {
                            navigateToSection(item.id, href)
                            return
                          }
                          requestLeave(() => navigateToSection(item.id, href))
                        }}
                      >
                        <Icon className={chipContentIconClass} />
                        <OverflowText
                          label={item.label}
                          className='sidebar-collapse-hide text-[var(--text-body)]'
                        />
                      </SettingsIntentLink>
                    )
                  })}
                </div>
              </SidebarSection>
            ))}
        </div>
      </div>
    </>
  )
}
