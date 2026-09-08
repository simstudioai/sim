'use client'

import { type ComponentType, useRef } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipTag,
  chipContentIconClass,
  chipVariants,
  cn,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { ArrowUpRight, ChevronLeft } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import {
  SETTINGS_PLANE_CHROME,
  type SettingsNavigationItem,
  type SettingsSection,
  type StandaloneSettingsPlane,
} from '@/components/settings/navigation'
import { SettingsIntentLink } from '@/components/settings/settings-intent-link'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { SimWordmark } from '@/app/(landing)/components/navbar/components'
import { SidebarSection } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-section'
import { SidebarTooltip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-tooltip'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_RAIL_CHIP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/**
 * The marketing landing page. `?home` is required: the proxy bounces a
 * signed-in user off `/` to the app entry unless the param is present.
 */
const LANDING_HREF = '/?home'

interface SettingsNavigationGroup {
  key: string
  title: string
}

interface SidebarSettingsItem<Section extends SettingsSection>
  extends SettingsNavigationItem<Section> {
  locked?: boolean
}

/**
 * A row that leads out of these settings rather than to a section of them —
 * drawn like the workspace sidebar's Organization row, with the up-right arrow.
 * Rendered after its group's sections.
 */
export interface SettingsSidebarOutboundLink {
  id: string
  group: string
  label: string
  icon: ComponentType<{ className?: string }>
}

interface SettingsSidebarProps<Section extends SettingsSection> {
  activeSection: string
  plane: StandaloneSettingsPlane
  groups: readonly SettingsNavigationGroup[]
  hrefForSection: (section: Section) => string
  items: readonly SidebarSettingsItem<Section>[]
  outboundLinks?: readonly SettingsSidebarOutboundLink[]
  isCollapsed?: boolean
  showCollapsedTooltips?: boolean
  backHref?: string
}

export function SettingsSidebar<Section extends SettingsSection>({
  activeSection,
  plane,
  groups,
  hrefForSection,
  items,
  outboundLinks = [],
  isCollapsed = false,
  showCollapsedTooltips = false,
  backHref = APP_ENTRY_PATH,
}: SettingsSidebarProps<Section>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const confirmLeave = useSettingsDirtyStore((state) => state.confirmLeave)
  const cancelLeave = useSettingsDirtyStore((state) => state.cancelLeave)
  const pendingLeave = useSettingsDirtyStore((state) => state.pendingLeave)
  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })

  return (
    <>
      {/* The divider is the pinned block's bottom rule, not the scroll region's top one:
          the region's edge fade masks its own first pixels, which would erase a rule
          drawn there exactly when it should show. Same construction as the footer. */}
      <div
        className={cn(
          plane === 'organization' && SIDEBAR_SECTION_GAP_CLASS,
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
          <SidebarTooltip label='Back' enabled={showCollapsedTooltips}>
            <Chip
              fullWidth
              leftIcon={ChevronLeft}
              className={SIDEBAR_RAIL_CHIP_CLASS}
              onClick={() => requestLeave(() => router.push(backHref))}
            >
              <span className='sidebar-collapse-hide'>Back</span>
            </Chip>
          </SidebarTooltip>
        )}
      </div>

      <div
        ref={isCollapsed ? undefined : scrollContainerRef}
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
              links: outboundLinks.filter((link) => link.group === group.key),
            }))
            .filter((group) => group.items.length > 0 || group.links.length > 0)
            .map((group, index) => (
              <SidebarSection
                key={group.key}
                title={group.title}
                railCollapsed={isCollapsed}
                className={cn(index > 0 && SIDEBAR_SECTION_GAP_CLASS, 'shrink-0')}
              >
                <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = activeSection === item.id
                    const href = hrefForSection(item.id)
                    return (
                      <SidebarTooltip
                        key={item.id}
                        label={item.label}
                        enabled={showCollapsedTooltips}
                      >
                        <SettingsIntentLink
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
                            const { isDirty, navigationBlocked } = useSettingsDirtyStore.getState()
                            if (!isDirty && !navigationBlocked) return
                            event.preventDefault()
                            requestLeave(() => router.replace(href, { scroll: false }))
                          }}
                        >
                          <Icon className={chipContentIconClass} />
                          <OverflowText
                            label={item.label}
                            className='sidebar-collapse-hide text-[var(--text-body)]'
                            tooltipEnabled={!showCollapsedTooltips}
                          />
                          {item.locked && (
                            <ChipTag
                              variant='mono'
                              className='sidebar-collapse-hide ml-auto shrink-0'
                            >
                              Plan
                            </ChipTag>
                          )}
                        </SettingsIntentLink>
                      </SidebarTooltip>
                    )
                  })}
                  {group.links.map((link) => {
                    const Icon = link.icon
                    return (
                      <SidebarTooltip
                        key={link.id}
                        label={link.label}
                        enabled={showCollapsedTooltips}
                      >
                        <button
                          type='button'
                          className={cn(chipVariants({ fullWidth: true }), SIDEBAR_RAIL_CHIP_CLASS)}
                        >
                          <Icon className={chipContentIconClass} />
                          <OverflowText
                            label={link.label}
                            className='sidebar-collapse-hide text-[var(--text-body)]'
                            tooltipEnabled={!showCollapsedTooltips}
                          />
                          <ArrowUpRight
                            className={cn('sidebar-collapse-hide ml-auto', chipContentIconClass)}
                          />
                        </button>
                      </SidebarTooltip>
                    )
                  })}
                </div>
              </SidebarSection>
            ))}
        </div>
      </div>

      <ChipConfirmModal
        open={pendingLeave !== null}
        onOpenChange={(open) => !open && cancelLeave()}
        srTitle='Unsaved changes'
        title='Unsaved changes'
        text='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{ label: 'Discard changes', onClick: confirmLeave }}
      />
    </>
  )
}
