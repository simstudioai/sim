'use client'

import { type ReactNode, useState } from 'react'
import type { Folder, Item, Separator } from 'fumadocs-core/page-tree'
import { useSidebar } from 'fumadocs-ui/components/sidebar/base'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function SidebarChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width='5'
      height='8'
      viewBox='0 0 6 10'
      fill='none'
      className={cn(
        'flex-shrink-0 transition-transform duration-200',
        open && 'rotate-90',
        className
      )}
    >
      <path
        d='M1 1L5 5L1 9'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        strokeLinejoin='miter'
      />
    </svg>
  )
}

const LANG_PREFIXES = i18n.languages.map((l) => `/${l}`)

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

const ITEM_BASE =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--text-muted)] text-sm transition-colors hover:bg-[var(--surface-active)] hover:text-[var(--text-body)]'
const ITEM_ACTIVE_MOBILE = 'bg-[var(--surface-active)] font-medium text-[var(--text-primary)]'

const ITEM_DESKTOP =
  'lg:mb-[0.0625rem] lg:block lg:rounded-lg lg:px-2.5 lg:py-1.5 lg:font-normal lg:text-[13px] lg:leading-tight'
const ITEM_TEXT = 'lg:text-[var(--text-body)]'
const ITEM_HOVER = 'lg:hover:bg-[var(--surface-3)]'
const ITEM_ACTIVE = 'lg:bg-[var(--surface-active)] lg:font-normal lg:text-[var(--text-body)]'

const FOLDER_TEXT = 'lg:text-[var(--text-body)] lg:font-medium'
const FOLDER_HOVER = 'lg:hover:bg-[var(--surface-3)]'
const FOLDER_ACTIVE = 'lg:bg-[var(--surface-active)] lg:text-[var(--text-body)]'

export function SidebarItem({ item }: { item: Item }) {
  const pathname = usePathname()
  const { prefetch } = useSidebar()
  const active = isActive(item.url, pathname, false)

  return (
    <Link
      href={item.url}
      prefetch={prefetch}
      data-active={active}
      className={cn(
        ITEM_BASE,
        active && ITEM_ACTIVE_MOBILE,
        ITEM_DESKTOP,
        ITEM_TEXT,
        !active && ITEM_HOVER,
        active && ITEM_ACTIVE
      )}
    >
      {item.name}
    </Link>
  )
}

function isApiReferenceFolder(node: Folder): boolean {
  if (node.index?.url.includes('/api-reference/')) return true
  for (const child of node.children) {
    if (child.type === 'page' && child.url.includes('/api-reference/')) return true
    if (child.type === 'folder' && isApiReferenceFolder(child)) return true
  }
  return false
}

export function SidebarFolder({ item, children }: { item: Folder; children: ReactNode }) {
  const pathname = usePathname()
  const { prefetch } = useSidebar()
  const hasActiveChild = checkHasActiveChild(item, pathname)
  const isApiRef = isApiReferenceFolder(item)
  const isOnApiRefPage = stripLangPrefix(pathname).startsWith('/api-reference')
  const hasChildren = item.children.length > 0
  const defaultOpen = hasActiveChild || (isApiRef && isOnApiRefPage)
  const [manualOpen, setManualOpen] = useState<{ pathname: string; open: boolean } | null>(null)
  const open = manualOpen?.pathname === pathname ? manualOpen.open : defaultOpen
  const toggleOpen = () => setManualOpen({ pathname, open: !open })
  const active = item.index ? isActive(item.index.url, pathname, false) : false

  if (item.index && !hasChildren) {
    return (
      <Link
        href={item.index.url}
        prefetch={prefetch}
        data-active={active}
        className={cn(
          ITEM_BASE,
          active && ITEM_ACTIVE_MOBILE,
          ITEM_DESKTOP,
          ITEM_TEXT,
          !active && ITEM_HOVER,
          active && ITEM_ACTIVE
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
          <>
            <Link
              href={item.index.url}
              prefetch={prefetch}
              data-active={active}
              className={cn(
                'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                'text-[var(--text-muted)] hover:bg-[var(--surface-active)] hover:text-[var(--text-body)]',
                active && ITEM_ACTIVE_MOBILE,
                'lg:block lg:flex-1 lg:rounded-lg lg:px-2.5 lg:py-1.5 lg:text-[13px] lg:leading-tight',
                FOLDER_TEXT,
                !active && FOLDER_HOVER,
                active && FOLDER_ACTIVE
              )}
            >
              {item.name}
            </Link>
            {hasChildren && (
              <button
                onClick={toggleOpen}
                className={cn(
                  'rounded-md p-1 hover:bg-[var(--surface-active)]',
                  'lg:cursor-pointer lg:rounded-md lg:p-1 lg:transition-colors lg:hover:bg-[var(--surface-3)]'
                )}
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                <SidebarChevron open={open} className='text-[var(--text-icon)]' />
              </button>
            )}
          </>
        ) : (
          <button
            onClick={toggleOpen}
            className={cn(
              'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
              'text-[var(--text-muted)] hover:bg-[var(--surface-active)]',
              'lg:flex lg:w-full lg:cursor-pointer lg:items-center lg:justify-between lg:rounded-lg lg:px-2.5 lg:py-1.5 lg:text-left lg:text-[13px] lg:leading-tight',
              FOLDER_TEXT,
              FOLDER_HOVER
            )}
          >
            <span>{item.name}</span>
            <SidebarChevron open={open} className='ml-auto text-[var(--text-icon)]' />
          </button>
        )}
      </div>
      {hasChildren && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className='overflow-hidden'>
            <div className='ml-4 flex flex-col gap-0.5 lg:hidden'>{children}</div>
            <ul className='mt-0.5 ml-2 hidden space-y-[0.0625rem] border-[var(--surface-active)] border-l pl-2.5 lg:block'>
              {children}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export function SidebarSeparator({ item }: { item: Separator }) {
  return (
    <div
      data-separator
      className={cn('mt-5 mb-1.5 px-2', 'lg:relative lg:mt-0 lg:mb-1.5 lg:px-[13px] lg:pt-0')}
    >
      <div className='separator-divider hidden'>
        <div className='h-[20px]' />
        <div className='h-px bg-[var(--surface-active)]' />
        <div className='h-[20px]' />
      </div>
      <p
        className={cn(
          'font-medium text-[var(--text-muted)] text-xs',
          'lg:font-semibold lg:text-[10px] lg:text-[var(--text-muted)] lg:uppercase lg:tracking-[0.06em]'
        )}
      >
        {item.name}
      </p>
    </div>
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
