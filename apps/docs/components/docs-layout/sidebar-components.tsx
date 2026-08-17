'use client'

import { type ReactNode, useState } from 'react'
import { chipActiveSurfaceClass, chipHoverSurfaceClass } from '@sim/emcn'
import { ChevronRight } from '@sim/emcn/icons'
import type { Folder, Item, Separator } from 'fumadocs-core/page-tree'
import { useSidebar } from 'fumadocs-ui/components/sidebar/base'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

function SidebarChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      className={cn(
        'size-[14px] flex-shrink-0 transition-transform duration-200',
        open && 'rotate-90',
        className
      )}
    />
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

/**
 * Rows mirror the app sidebar's chip pill: 30px tall, `rounded-lg`, `px-2`, 14px
 * at normal weight, `--text-body` at rest AND when active — only the background
 * moves, on the two-surface model — see emcn's `chipHoverSurfaceClass`.
 *
 * Height, horizontal padding, weight and color are additionally pinned in
 * `global.css` (`html #nd-sidebar a…`), which needs `!important` to beat
 * fumadocs' own sidebar rules and therefore also beats these utilities. Keep the
 * two in step: the classes here describe the intent and drive the mobile layout,
 * the stylesheet is what actually lands on desktop.
 */
const ITEM_BASE =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--text-body)] text-sm transition-colors'
const ITEM_ACTIVE_MOBILE = chipActiveSurfaceClass

const ITEM_DESKTOP =
  'lg:mb-[0.0625rem] lg:block lg:rounded-lg lg:px-2 lg:font-normal lg:text-sm lg:leading-tight'
const ITEM_TEXT = 'lg:text-[var(--text-body)]'
/**
 * Unprefixed, and applied only to inactive rows — an unconditional hover in
 * `ITEM_BASE` would fade the current page under the pointer below `lg`.
 */
const ITEM_HOVER = chipHoverSurfaceClass
const ITEM_ACTIVE = 'lg:bg-[var(--surface-active)] lg:font-normal lg:text-[var(--text-body)]'

const FOLDER_TEXT = 'lg:text-[var(--text-body)] lg:font-normal'
const FOLDER_HOVER = chipHoverSurfaceClass
const FOLDER_ACTIVE = 'lg:bg-[var(--surface-active)] lg:text-[var(--text-body)]'

const itemClass = (active: boolean) =>
  cn(ITEM_BASE, ITEM_DESKTOP, ITEM_TEXT, active ? cn(ITEM_ACTIVE_MOBILE, ITEM_ACTIVE) : ITEM_HOVER)

export function SidebarItem({ item }: { item: Item }) {
  const pathname = usePathname()
  const { prefetch } = useSidebar()
  const active = isActive(item.url, pathname, false)

  return (
    <Link href={item.url} prefetch={prefetch} data-active={active} className={itemClass(active)}>
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
        className={itemClass(active)}
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
                'text-[var(--text-body)]',
                'lg:block lg:flex-1 lg:rounded-lg lg:px-2 lg:text-sm lg:leading-tight',
                FOLDER_TEXT,
                active ? cn(ITEM_ACTIVE_MOBILE, FOLDER_ACTIVE) : FOLDER_HOVER
              )}
            >
              {item.name}
            </Link>
            {hasChildren && (
              <button
                onClick={toggleOpen}
                className={cn(
                  'rounded-md p-1 transition-colors lg:cursor-pointer',
                  chipHoverSurfaceClass
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
              'text-[var(--text-body)]',
              'lg:flex lg:w-full lg:cursor-pointer lg:items-center lg:justify-between lg:rounded-lg lg:px-2 lg:text-left lg:text-sm lg:leading-tight',
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
            <ul className='mt-0.5 ml-2 hidden space-y-[0.0625rem] pl-2.5 lg:block'>{children}</ul>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Group label. Mirrors the app sidebar's section header: a 12px `--text-muted`
 * row at normal weight in sentence case, with the group's 16px top gap carried
 * by the label itself (the app's `SIDEBAR_SECTION_GAP_CLASS`). Groups are told
 * apart by that gap alone — the app draws no rule between them.
 */
export function SidebarSeparator({ item }: { item: Separator }) {
  return (
    <div data-separator className='mt-4 mb-1.5 px-2 first:mt-0'>
      <p className='text-[var(--text-muted)] text-caption'>{item.name}</p>
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
