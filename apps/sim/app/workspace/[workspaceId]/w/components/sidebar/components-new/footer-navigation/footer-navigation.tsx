'use client'

import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { Database, HelpCircle, Layout, LibraryBig, Settings } from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { HelpModal } from '../help-modal'
import { SettingsModal } from '../settings-modal'

interface FooterNavigationItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  onClick?: () => void
}

/**
 * FooterNavigation component displaying navigation links at the bottom of the sidebar.
 * Styled to match WorkflowItem for visual consistency.
 *
 * @returns Footer navigation section with links to key pages
 */
export function FooterNavigation() {
  const params = useParams()
  const pathname = usePathname()
  const workspaceId = params.workspaceId as string

  // Modal states
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  const navigationItems: FooterNavigationItem[] = [
    {
      id: 'logs',
      label: 'Logs',
      icon: LibraryBig,
      href: `/workspace/${workspaceId}/logs`,
    },
    {
      id: 'templates',
      label: 'Templates',
      icon: Layout,
      href: `/workspace/${workspaceId}/templates`,
    },
    {
      id: 'knowledge-base',
      label: 'Vector Database',
      icon: Database,
      href: `/workspace/${workspaceId}/knowledge`,
    },
    {
      id: 'help',
      label: 'Help',
      icon: HelpCircle,
      onClick: () => setIsHelpModalOpen(true),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      onClick: () => setIsSettingsModalOpen(true),
    },
  ]

  /**
   * Check if a navigation item is currently active
   *
   * @param href - The href to check against current pathname
   * @returns True if the item is active
   */
  const isActive = useCallback(
    (href: string) => {
      return pathname?.startsWith(href)
    },
    [pathname]
  )

  return (
    <>
      <div className='flex flex-shrink-0 flex-col gap-[2px] border-t px-[7.75px] pt-[8px] pb-[8px] dark:border-[var(--border)]'>
        {navigationItems.map((item) => {
          const Icon = item.icon
          const active = item.href ? isActive(item.href) : false

          const itemClasses = clsx(
            'group flex h-[24px] items-center gap-[8px] rounded-[8px] px-[7px] text-[14px]',
            active
              ? 'bg-[var(--border)] dark:bg-[var(--border)]'
              : 'hover:bg-[var(--border)] dark:hover:bg-[var(--border)]'
          )

          const iconClasses = clsx(
            'h-[14px] w-[14px] flex-shrink-0',
            active
              ? 'text-[var(--text-primary)] dark:text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:group-hover:text-[var(--text-primary)]'
          )

          const labelClasses = clsx(
            'truncate font-base text-[13px]',
            active
              ? 'text-[var(--text-primary)] dark:text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:group-hover:text-[var(--text-primary)]'
          )

          const content = (
            <>
              <Icon className={iconClasses} />
              <span className={labelClasses}>{item.label}</span>
            </>
          )

          // Render as button if onClick is provided, otherwise as Link
          if (item.onClick) {
            return (
              <button
                key={item.id}
                type='button'
                data-item-id={item.id}
                className={itemClasses}
                onClick={item.onClick}
              >
                {content}
              </button>
            )
          }

          return (
            <Link key={item.id} href={item.href!} data-item-id={item.id} className={itemClasses}>
              {content}
            </Link>
          )
        })}
      </div>

      {/* Modals */}
      <HelpModal open={isHelpModalOpen} onOpenChange={setIsHelpModalOpen} />
      <SettingsModal open={isSettingsModalOpen} onOpenChange={setIsSettingsModalOpen} />
    </>
  )
}
