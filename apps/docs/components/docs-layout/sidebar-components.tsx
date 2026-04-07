'use client'

import { type ReactNode, useEffect, useState } from 'react'
import type { Folder, Item, Separator } from 'fumadocs-core/page-tree'
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
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground'
const ITEM_ACTIVE_MOBILE = 'bg-fd-primary/10 font-medium text-fd-primary'

const ITEM_DESKTOP =
  'lg:mb-[0.0625rem] lg:block lg:rounded-lg lg:px-2.5 lg:py-1.5 lg:font-normal lg:text-[13px] lg:leading-tight'
const ITEM_TEXT = 'lg:text-[#3b3b3b] lg:dark:text-[#cdcdcd]'
const ITEM_HOVER = 'lg:hover:bg-[#f2f2f2] lg:dark:hover:bg-[#262626]'
const ITEM_ACTIVE =
  'lg:bg-[#ececec] lg:font-normal lg:text-[#3b3b3b] lg:dark:bg-[#2c2c2c] lg:dark:text-[#cdcdcd]'

const FOLDER_TEXT = 'lg:text-[#3b3b3b] lg:font-medium lg:dark:text-[#cdcdcd]'
const FOLDER_HOVER = 'lg:hover:bg-[#f2f2f2] lg:dark:hover:bg-[#262626]'
const FOLDER_ACTIVE =
  'lg:bg-[#ececec] lg:text-[#3b3b3b] lg:dark:bg-[#2c2c2c] lg:dark:text-[#cdcdcd]'

export function SidebarItem({ item }: { item: Item }) {
  const pathname = usePathname()
  const active = isActive(item.url, pathname, false)

  return (
    <Link
      href={item.url}
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
  const hasActiveChild = checkHasActiveChild(item, pathname)
  const isApiRef = isApiReferenceFolder(item)
  const isOnApiRefPage = stripLangPrefix(pathname).startsWith('/api-reference')
  const hasChildren = item.children.length > 0
  const [open, setOpen] = useState(hasActiveChild || (isApiRef && isOnApiRefPage))

  useEffect(() => {
    setOpen(hasActiveChild || (isApiRef && isOnApiRefPage))
  }, [hasActiveChild, isApiRef, isOnApiRefPage])

  const active = item.index ? isActive(item.index.url, pathname, false) : false

  if (item.index && !hasChildren) {
    return (
      <Link
        href={item.index.url}
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
              data-active={active}
              className={cn(
                'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                'text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground',
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
                onClick={() => setOpen(!open)}
                className={cn(
                  'rounded p-1 hover:bg-fd-accent/50',
                  'lg:cursor-pointer lg:rounded lg:p-1 lg:transition-colors lg:hover:bg-[#f2f2f2] lg:dark:hover:bg-[#262626]'
                )}
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                <SidebarChevron open={open} className='text-[#5e5e5e] dark:text-[#939393]' />
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
              'text-fd-muted-foreground hover:bg-fd-accent/50',
              'lg:flex lg:w-full lg:cursor-pointer lg:items-center lg:justify-between lg:rounded-lg lg:px-2.5 lg:py-1.5 lg:text-left lg:text-[13px] lg:leading-tight',
              FOLDER_TEXT,
              FOLDER_HOVER
            )}
          >
            <span>{item.name}</span>
            <SidebarChevron open={open} className='ml-auto text-[#5e5e5e] dark:text-[#939393]' />
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
            <ul className='mt-0.5 ml-2 hidden space-y-[0.0625rem] border-[#ececec] border-l pl-2.5 lg:block dark:border-[#2c2c2c]'>
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
        <div className='h-px bg-[#ececec] dark:bg-[#2c2c2c]' />
        <div className='h-[20px]' />
      </div>
      <p
        className={cn(
          'font-medium text-fd-muted-foreground text-xs',
          'lg:font-semibold lg:text-[#5e5e5e] lg:text-[10px] lg:uppercase lg:tracking-[0.06em] lg:dark:text-[#939393]'
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
