'use client'

import { useEffect, useRef, useState } from 'react'
import { ChipConfirmModal, chipVariants, cn, Tooltip } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import type { SettingsNavigationItem, SettingsSection } from '@/components/settings/navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface SettingsNavigationGroup {
  key: string
  title: string
}

interface SidebarSettingsItem<Section extends SettingsSection>
  extends SettingsNavigationItem<Section> {
  locked?: boolean
}

interface SettingsSidebarProps<Section extends SettingsSection> {
  activeSection: string
  backHref: string
  groups: readonly SettingsNavigationGroup[]
  hrefForSection: (section: Section) => string
  items: readonly SidebarSettingsItem<Section>[]
  isCollapsed?: boolean
  showCollapsedTooltips?: boolean
}

function SidebarTooltip({
  children,
  label,
  enabled,
}: {
  children: React.ReactElement
  label: string
  enabled: boolean
}) {
  if (!enabled) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Content side='right'>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

export function SettingsSidebar<Section extends SettingsSection>({
  activeSection,
  backHref,
  groups,
  hrefForSection,
  items,
  isCollapsed = false,
  showCollapsedTooltips = false,
}: SettingsSidebarProps<Section>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const confirmLeave = useSettingsDirtyStore((state) => state.confirmLeave)
  const cancelLeave = useSettingsDirtyStore((state) => state.cancelLeave)
  const pendingLeave = useSettingsDirtyStore((state) => state.pendingLeave)
  const [hasOverflowTop, setHasOverflowTop] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const updateScrollState = () => setHasOverflowTop(container.scrollTop > 1)
    updateScrollState()
    container.addEventListener('scroll', updateScrollState, { passive: true })
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(container)
    if (scrollContentRef.current) observer.observe(scrollContentRef.current)
    return () => {
      container.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [isCollapsed])

  return (
    <>
      <div className='flex flex-shrink-0 flex-col gap-0.5 px-2 pb-1.5'>
        <SidebarTooltip label='Back' enabled={showCollapsedTooltips}>
          <button
            type='button'
            disabled={!isHydrated}
            onClick={() => requestLeave(() => router.push(backHref))}
            className={chipVariants({ fullWidth: true })}
          >
            <div className='flex size-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]'>
              <ChevronDown className='size-[10px] rotate-90' />
            </div>
            <span className='sidebar-collapse-hide truncate text-[var(--text-body)]'>Back</span>
          </button>
        </SidebarTooltip>
      </div>

      <div
        ref={isCollapsed ? undefined : scrollContainerRef}
        className={cn(
          'flex flex-1 flex-col overflow-y-auto overflow-x-hidden border-t pt-1.5 transition-colors duration-150',
          !hasOverflowTop && 'border-transparent'
        )}
      >
        <div ref={scrollContentRef} className='flex flex-col'>
          {groups
            .map((group) => ({
              ...group,
              items: items.filter((item) => item.group === group.key),
            }))
            .filter((group) => group.items.length > 0)
            .map((group, index) => (
              <div
                key={group.key}
                className={cn(index > 0 && 'mt-6', 'flex flex-shrink-0 flex-col')}
              >
                <div className='px-4 pb-2'>
                  <div className='text-[var(--text-muted)] text-small'>{group.title}</div>
                </div>
                <div className='flex flex-col gap-0.5 px-2'>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = activeSection === item.id
                    return (
                      <SidebarTooltip
                        key={item.id}
                        label={item.label}
                        enabled={showCollapsedTooltips}
                      >
                        <button
                          type='button'
                          disabled={!isHydrated}
                          aria-label={item.label}
                          aria-current={active ? 'page' : undefined}
                          className={chipVariants({ active, fullWidth: true })}
                          onClick={() => {
                            if (active) return
                            requestLeave(() => {
                              router.replace(hrefForSection(item.id), { scroll: false })
                            })
                          }}
                        >
                          <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                          <span className='sidebar-collapse-hide min-w-0 truncate text-[var(--text-body)]'>
                            {item.label}
                          </span>
                          {item.locked && (
                            <span className='sidebar-collapse-hide ml-auto shrink-0 rounded-[3px] bg-[var(--surface-5)] px-1 py-[1px] font-medium text-[var(--text-icon)] text-micro uppercase tracking-wide'>
                              Plan
                            </span>
                          )}
                        </button>
                      </SidebarTooltip>
                    )
                  })}
                </div>
              </div>
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
