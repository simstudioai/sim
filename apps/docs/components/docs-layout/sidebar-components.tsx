'use client'

import { type ReactNode, useId, useState } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import { ChevronRight } from '@sim/emcn/icons'
import type { Folder, Item, Separator } from 'fumadocs-core/page-tree'
import { useSidebar } from 'fumadocs-ui/components/sidebar/base'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface SidebarItemProps {
  item: Item
}

interface SidebarFolderProps {
  item: Folder
  children: ReactNode
}

interface SidebarSeparatorProps {
  item: Separator
}

export function SidebarItem({ item }: SidebarItemProps) {
  const pathname = usePathname()
  const { prefetch, setOpen } = useSidebar()
  const active = item.url === pathname

  return (
    <ChipLink
      href={item.url}
      prefetch={prefetch}
      fullWidth
      active={active}
      data-active={active}
      aria-current={active ? 'page' : undefined}
      onNavigate={() => {
        setOpen(false)
      }}
    >
      {item.name}
    </ChipLink>
  )
}

/** A section is one link: navigate to its overview, then toggle it on subsequent clicks. */
export function SidebarFolder({ item, children }: SidebarFolderProps) {
  const contentId = useId()
  const pathname = usePathname()
  const { prefetch, open: drawerOpen, setOpen } = useSidebar()
  const [manualOpen, setManualOpen] = useState<{ pathname: string; open: boolean } | null>(null)
  if (manualOpen && manualOpen.pathname !== pathname) setManualOpen(null)
  const hasChildren = item.children.length > 0
  const active = item.index?.url === pathname
  const open =
    manualOpen?.pathname === pathname ? manualOpen.open : hasActiveDescendant(item, pathname)
  const toggleOpen = () => setManualOpen({ pathname, open: !open })
  const chevron = hasChildren ? (
    <ChevronRight
      className={cn(
        'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform duration-200 motion-reduce:transition-none',
        open && 'rotate-90'
      )}
    />
  ) : undefined

  return (
    <div className='flex flex-col'>
      {item.index ? (
        <ChipLink
          href={item.index.url}
          prefetch={prefetch}
          fullWidth
          active={active}
          data-active={active}
          aria-current={active ? 'page' : undefined}
          aria-expanded={hasChildren ? open : undefined}
          aria-controls={hasChildren ? contentId : undefined}
          rightAdornment={chevron}
          onNavigate={(event) => {
            if (drawerOpen) {
              setManualOpen(null)
              setOpen(false)
            } else if (active && hasChildren) {
              event.preventDefault()
              toggleOpen()
            } else {
              setManualOpen(null)
            }
          }}
        >
          {item.name}
        </ChipLink>
      ) : (
        <Chip
          fullWidth
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls={contentId}
          rightAdornment={chevron}
        >
          {item.name}
        </Chip>
      )}
      {hasChildren && (
        <div
          id={contentId}
          inert={!open}
          aria-hidden={!open}
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className='overflow-hidden'>
            <div className='mt-px ml-4 flex flex-col gap-px'>{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SidebarSeparator({ item }: SidebarSeparatorProps) {
  return (
    <div data-separator className='mt-4 mb-1.5 px-2 first:mt-0'>
      <p className='text-[var(--text-icon)] text-caption'>{item.name}</p>
    </div>
  )
}

function hasActiveDescendant(node: Folder, pathname: string): boolean {
  if (node.index?.url === pathname) return true
  return node.children.some((child) =>
    child.type === 'page'
      ? child.url === pathname
      : child.type === 'folder' && hasActiveDescendant(child, pathname)
  )
}
