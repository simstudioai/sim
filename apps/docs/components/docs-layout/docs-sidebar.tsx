'use client'

import { useEffect, useRef } from 'react'
import { Chip, ChipLink, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import type { Node } from 'fumadocs-core/page-tree'
import { useMediaQuery } from 'fumadocs-core/utils/use-media-query'
import { useSidebar } from 'fumadocs-ui/components/sidebar/base'
import { useTreeContext } from 'fumadocs-ui/contexts/tree'
import { usePathname } from 'next/navigation'
import {
  SidebarFolder,
  SidebarItem,
  SidebarSeparator,
} from '@/components/docs-layout/sidebar-components'
import { DOCS_SECTIONS, getDocsSection } from '@/lib/navigation'
import { cn } from '@/lib/utils'

interface SidebarTreeProps {
  nodes: Node[]
}

function SidebarTree({ nodes }: SidebarTreeProps) {
  return nodes.map((node, index) => {
    if (node.type === 'separator') return <SidebarSeparator key={index} item={node} />
    if (node.type === 'folder') {
      return (
        <SidebarFolder key={index} item={node}>
          <SidebarTree nodes={node.children} />
        </SidebarFolder>
      )
    }
    return <SidebarItem key={node.url} item={node} />
  })
}

function SidebarScrollArea() {
  const ref = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(ref)
  const { root } = useTreeContext()
  const pathname = usePathname()

  useEffect(() => {
    const viewport = ref.current
    const current = viewport?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!viewport || !current) return
    const bounds = viewport.getBoundingClientRect()
    const row = current.getBoundingClientRect()
    if (row.top < bounds.top) viewport.scrollTop += row.top - bounds.top - 12
    else if (row.bottom > bounds.bottom) viewport.scrollTop += row.bottom - bounds.bottom + 12
  }, [pathname])

  return (
    <div
      ref={ref}
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', scrollFadeClass)}
      {...scrollFadeAttributes(edges)}
    >
      <div className='flex flex-col gap-px px-2 py-4 lg:pr-3.5 lg:pl-[calc(var(--nav-inset)-8px)]'>
        <SidebarTree key={root.$id} nodes={root.children} />
      </div>
    </div>
  )
}

/** The native modal supplies focus containment, Escape dismissal, and focus restoration. */
export function DocsSidebar() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { open, setOpen } = useSidebar()
  const mobile = useMediaQuery('(width < 1024px)')
  const section = getDocsSection(usePathname())

  useEffect(() => {
    const dialog = dialogRef.current
    if (!mobile && open) {
      setOpen(false)
      return
    }
    if (open && mobile) dialog?.showModal()
    else dialog?.close()
  }, [open, mobile, setOpen])

  if (mobile) {
    return (
      <dialog
        ref={dialogRef}
        aria-label='Documentation navigation'
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right) setOpen(false)
        }}
        className='fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[85%] max-w-[380px] border-[var(--border)] border-l bg-[var(--surface-1)] p-0 text-[var(--text-body)] backdrop:bg-black/30 backdrop:backdrop-blur-xs open:flex open:flex-col'
      >
        <div className='shrink-0 border-[var(--border)] border-b'>
          <div className='flex h-12 items-center justify-between gap-3 px-4'>
            <span className='text-[var(--text-primary)] text-sm'>Documentation</span>
            <Chip
              aria-label='Close navigation'
              leftIcon={X}
              mobileCompact
              onClick={() => setOpen(false)}
            />
          </div>
          <nav
            aria-label='Documentation sections'
            className='flex flex-wrap items-center gap-px bg-transparent! px-2 pb-2'
          >
            {DOCS_SECTIONS.map((item) => (
              <ChipLink
                key={item.slug}
                href={item.href}
                active={section === item.slug}
                aria-current={section === item.slug ? 'page' : undefined}
                mobileCompact
                onNavigate={() => setOpen(false)}
              >
                {item.compactLabel}
              </ChipLink>
            ))}
          </nav>
        </div>
        {open && <SidebarScrollArea />}
      </dialog>
    )
  }

  return (
    <div
      data-sidebar-placeholder=''
      className='sticky top-[var(--fd-docs-row-1)] hidden h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] bg-[var(--surface-1)] [grid-area:sidebar] lg:block'
    >
      <aside aria-label='Documentation navigation' className='flex h-full flex-col'>
        <SidebarScrollArea />
      </aside>
    </div>
  )
}
