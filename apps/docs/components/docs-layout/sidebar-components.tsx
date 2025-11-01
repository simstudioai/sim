'use client'

import { type ReactNode, useEffect, useState } from 'react'
import type { PageTree } from 'fumadocs-core/server'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

function isActive(url: string, pathname: string, nested = true): boolean {
  return url === pathname || (nested && pathname.startsWith(`${url}/`))
}

export function SidebarItem({ item }: { item: PageTree.Item }) {
  const pathname = usePathname()
  const active = isActive(item.url, pathname, false)

  return (
    <li className='mb-[0.0625rem] list-none'>
      <Link
        href={item.url}
        className={cn(
          'block rounded-md px-2.5 py-1.5 font-normal text-[13px] leading-tight transition-colors',
          'text-gray-600 dark:text-gray-400',
          !active && 'hover:bg-gray-100/60 dark:hover:bg-gray-800/40',
          active &&
            'bg-purple-50/80 font-medium text-purple-600 dark:bg-purple-900/15 dark:text-purple-400'
        )}
      >
        {item.name}
      </Link>
    </li>
  )
}

export function SidebarFolder({
  item,
  level,
  children,
}: {
  item: PageTree.Folder
  level: number
  children: ReactNode
}) {
  const pathname = usePathname()
  const hasActiveChild = checkHasActiveChild(item, pathname)
  const [open, setOpen] = useState(hasActiveChild)

  useEffect(() => {
    setOpen(hasActiveChild)
  }, [hasActiveChild])

  return (
    <li className='mb-[0.0625rem] list-none'>
      {item.index ? (
        <div className='flex items-center gap-0.5'>
          <Link
            href={item.index.url}
            className={cn(
              'block flex-1 rounded-md px-2.5 py-1.5 font-medium text-[13px] leading-tight transition-colors',
              'text-gray-800 dark:text-gray-200',
              !isActive(item.index.url, pathname, false) &&
                'hover:bg-gray-100/60 dark:hover:bg-gray-800/40',
              isActive(item.index.url, pathname, false) &&
                'bg-purple-50/80 text-purple-600 dark:bg-purple-900/15 dark:text-purple-400'
            )}
          >
            {item.name}
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className='rounded p-1 transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-800/40'
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={cn(
                'h-3 w-3 text-gray-400 transition-transform duration-200 ease-in-out dark:text-gray-500',
                open && 'rotate-90'
              )}
            />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left font-medium text-[13px] leading-tight transition-colors',
            'hover:bg-gray-100/60 dark:hover:bg-gray-800/40',
            'text-gray-800 dark:text-gray-200'
          )}
        >
          <span>{item.name}</span>
          <ChevronRight
            className={cn(
              'ml-auto h-3 w-3 flex-shrink-0 text-gray-400 transition-transform duration-200 ease-in-out dark:text-gray-500',
              open && 'rotate-90'
            )}
          />
        </button>
      )}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-in-out',
          open ? 'max-h-[10000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <ul className='mt-0.5 ml-2 space-y-[0.0625rem] border-gray-200/60 border-l pl-2.5 dark:border-gray-700/60'>
          {children}
        </ul>
      </div>
    </li>
  )
}

export function SidebarSeparator({ item }: { item: PageTree.Separator }) {
  return (
    <p className='mt-4 mb-1.5 px-2.5 font-semibold text-[10px] text-gray-500/80 uppercase tracking-wide dark:text-gray-500'>
      {item.name}
    </p>
  )
}

function checkHasActiveChild(node: PageTree.Folder, pathname: string): boolean {
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
