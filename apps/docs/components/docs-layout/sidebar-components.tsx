'use client'

import { type ReactNode, useEffect, useState } from 'react'
import type { Folder, Item, Separator } from 'fumadocs-core/page-tree'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LANG_PREFIXES = ['/en', '/es', '/fr', '/de', '/ja', '/zh']

function stripLangPrefix(path: string): string {
  for (const prefix of LANG_PREFIXES) {
    if (path === prefix) return '/'
    if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length)
  }
  return path
}

function isActive(url: string, pathname: string, nested = true): boolean {
  const normalizedPathname = stripLangPrefix(pathname)
  const normalizedUrl = stripLangPrefix(url)
  return (
    normalizedUrl === normalizedPathname ||
    (nested && normalizedPathname.startsWith(`${normalizedUrl}/`))
  )
}

export function SidebarItem({ item }: { item: Item }) {
  const pathname = usePathname()
  const active = isActive(item.url, pathname, false)

  return (
    <Link
      href={item.url}
      data-active={active}
      className={cn(
        // Mobile styles (default)
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        'text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground',
        active && 'bg-fd-primary/10 font-medium text-fd-primary',
        // Desktop styles (lg+)
        'lg:mb-[0.0625rem] lg:block lg:rounded-md lg:px-2.5 lg:py-1.5 lg:font-normal lg:text-[13px] lg:leading-tight',
        'lg:text-gray-600 lg:dark:text-gray-400',
        !active && 'lg:hover:bg-gray-100/60 lg:dark:hover:bg-gray-800/40',
        active &&
          'lg:bg-emerald-50/80 lg:font-normal lg:text-emerald-600 lg:dark:bg-emerald-900/15 lg:dark:text-emerald-400'
      )}
    >
      {item.name}
    </Link>
  )
}

export function SidebarFolder({ item, children }: { item: Folder; children: ReactNode }) {
  const pathname = usePathname()
  const hasActiveChild = checkHasActiveChild(item, pathname)
  const hasChildren = item.children.length > 0
  const [open, setOpen] = useState(hasActiveChild)

  useEffect(() => {
    setOpen(hasActiveChild)
  }, [hasActiveChild])

  const active = item.index ? isActive(item.index.url, pathname, false) : false

  if (item.index && !hasChildren) {
    return (
      <Link
        href={item.index.url}
        data-active={active}
        className={cn(
          // Mobile styles (default)
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          'text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground',
          active && 'bg-fd-primary/10 font-medium text-fd-primary',
          // Desktop styles (lg+)
          'lg:mb-[0.0625rem] lg:block lg:rounded-md lg:px-2.5 lg:py-1.5 lg:font-normal lg:text-[13px] lg:leading-tight',
          'lg:text-gray-600 lg:dark:text-gray-400',
          !active && 'lg:hover:bg-gray-100/60 lg:dark:hover:bg-gray-800/40',
          active &&
            'lg:bg-emerald-50/80 lg:font-normal lg:text-emerald-600 lg:dark:bg-emerald-900/15 lg:dark:text-emerald-400'
        )}
      >
        {item.name}
      </Link>
    )
  }

  return (
    <div className='flex flex-col lg:mb-[0.0625rem]'>
      <div className='flex w-full items-center lg:gap-0.5'>
        {item.index ? (
          <Link
            href={item.index.url}
            data-active={active}
            className={cn(
              // Mobile styles (default)
              'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
              'text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground',
              active && 'bg-fd-primary/10 font-medium text-fd-primary',
              // Desktop styles (lg+)
              'lg:block lg:flex-1 lg:rounded-md lg:px-2.5 lg:py-1.5 lg:font-medium lg:text-[13px] lg:leading-tight',
              'lg:text-gray-800 lg:dark:text-gray-200',
              !active && 'lg:hover:bg-gray-100/60 lg:dark:hover:bg-gray-800/40',
              active &&
                'lg:bg-emerald-50/80 lg:text-emerald-600 lg:dark:bg-emerald-900/15 lg:dark:text-emerald-400'
            )}
          >
            {item.name}
          </Link>
        ) : (
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              // Mobile styles (default)
              'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
              'text-fd-muted-foreground hover:bg-fd-accent/50',
              // Desktop styles (lg+)
              'lg:flex lg:w-full lg:cursor-pointer lg:items-center lg:justify-between lg:rounded-md lg:px-2.5 lg:py-1.5 lg:text-left lg:font-medium lg:text-[13px] lg:leading-tight',
              'lg:text-gray-800 lg:hover:bg-gray-100/60 lg:dark:text-gray-200 lg:dark:hover:bg-gray-800/40'
            )}
          >
            <span>{item.name}</span>
            {/* Desktop-only chevron for non-index folders */}
            <ChevronRight
              className={cn(
                'ml-auto hidden h-3 w-3 flex-shrink-0 text-gray-400 transition-transform duration-200 ease-in-out lg:block dark:text-gray-500',
                open && 'rotate-90'
              )}
            />
          </button>
        )}
        {hasChildren && (
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              // Mobile styles
              'rounded p-1 hover:bg-fd-accent/50',
              // Desktop styles
              'lg:cursor-pointer lg:rounded lg:p-1 lg:transition-colors lg:hover:bg-gray-100/60 lg:dark:hover:bg-gray-800/40'
            )}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={cn(
                // Mobile styles
                'h-4 w-4 transition-transform',
                // Desktop styles
                'lg:h-3 lg:w-3 lg:text-gray-400 lg:duration-200 lg:ease-in-out lg:dark:text-gray-500',
                open && 'rotate-90'
              )}
            />
          </button>
        )}
      </div>
      {hasChildren && (
        <div
          className={cn(
            'overflow-hidden transition-all duration-200 ease-in-out',
            open ? 'max-h-[10000px] opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          {/* Mobile: simple indent */}
          <div className='ml-4 flex flex-col gap-0.5 lg:hidden'>{children}</div>
          {/* Desktop: styled with border */}
          <ul className='mt-0.5 ml-2 hidden space-y-[0.0625rem] border-gray-200/60 border-l pl-2.5 lg:block dark:border-gray-700/60'>
            {children}
          </ul>
        </div>
      )}
    </div>
  )
}

export function SidebarSeparator({ item }: { item: Separator }) {
  return (
    <p
      className={cn(
        // Mobile styles
        'mt-4 mb-2 px-2 font-medium text-fd-muted-foreground text-xs',
        // Desktop styles
        'lg:mt-4 lg:mb-1.5 lg:px-2.5 lg:font-semibold lg:text-[10px] lg:text-gray-500/80 lg:uppercase lg:tracking-wide lg:dark:text-gray-500'
      )}
    >
      {item.name}
    </p>
  )
}

function checkHasActiveChild(node: Folder, pathname: string): boolean {
  if (node.index && isActive(node.index.url, pathname)) {
    return true
  }

  for (const child of node.children) {
    if (child.type === 'page' && isActive(child.url, pathname)) {
      return true
    }
    if (child.type === 'folder' && checkHasActiveChild(child, pathname)) {
      return true
    }
  }

  return false
}
