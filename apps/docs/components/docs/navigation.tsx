'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from '@sim/emcn/icons'
import Link from 'next/link'
import { cn } from '@/components/docs/classnames'
import { MethodBadge } from '@/components/docs/primitives'
import type { NavNode } from '@/lib/content/types'

interface SidebarNavigationProps {
  nodes: NavNode[]
  pathname: string
  onNavigate?: () => void
}
interface NavigationItemProps extends Omit<SidebarNavigationProps, 'nodes'> {
  node: NavNode
}

const rowClass =
  'group flex min-h-[30px] w-full items-center gap-1.5 rounded-lg px-2 py-[5px] text-docs-nav text-[var(--docs-text)] transition-colors hover:bg-[var(--docs-hover)] active:bg-[var(--docs-pressed)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2'

function containsPath(node: NavNode, pathname: string): boolean {
  return (
    node.url === pathname || Boolean(node.children?.some((child) => containsPath(child, pathname)))
  )
}

function NavigationItem({ node, pathname, onNavigate }: NavigationItemProps) {
  const isBranch = Boolean(node.children?.length)
  const isCurrent = node.url === pathname
  const inBranch = containsPath(node, pathname)
  const [expanded, setExpanded] = useState(inBranch || Boolean(node.defaultOpen))
  useEffect(() => {
    if (!isBranch) return
    try {
      const saved = localStorage.getItem(`docs-branch:${node.id}`)
      setExpanded(inBranch || (saved === null ? Boolean(node.defaultOpen) : saved === 'true'))
    } catch {
      setExpanded(inBranch || Boolean(node.defaultOpen))
    }
  }, [inBranch, isBranch, node.id, node.defaultOpen])

  function toggle() {
    const value = !expanded
    setExpanded(value)
    try {
      localStorage.setItem(`docs-branch:${node.id}`, String(value))
    } catch {}
  }

  if (node.kind === 'label')
    return (
      <li className='mt-5 px-2 pb-1.5 text-[var(--docs-muted)] text-docs-caption first:mt-0'>
        {node.title}
      </li>
    )

  const label = (
    <>
      {node.method && <MethodBadge method={node.method} compact />}
      <span className='min-w-0 break-words'>{node.title}</span>
    </>
  )
  return (
    <li>
      {node.url ? (
        <div
          className={cn(
            'group/branch flex min-h-[30px] items-center rounded-lg pr-2 hover:bg-[var(--docs-hover)]',
            isCurrent && 'bg-[var(--docs-selected)] hover:bg-[var(--docs-selected)]'
          )}
        >
          <Link
            href={node.url}
            prefetch={false}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              rowClass,
              isBranch ? 'w-auto min-w-0 pr-0 hover:bg-transparent' : 'flex-1',
              isCurrent && 'hover:bg-[var(--docs-selected)]'
            )}
          >
            {label}
          </Link>
          {isBranch && (
            <button
              type='button'
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
              aria-expanded={expanded}
              onClick={toggle}
              className='ml-2 flex size-4 shrink-0 items-center opacity-0 focus-visible:opacity-100 group-focus-within/branch:opacity-100 group-hover/branch:opacity-100 [@media(hover:none)]:opacity-100'
            >
              <ChevronDown
                className={cn('size-4 transition-transform', !expanded && '-rotate-90')}
              />
            </button>
          )}
        </div>
      ) : (
        <button type='button' onClick={toggle} aria-expanded={expanded} className={rowClass}>
          {label}
          <ChevronDown
            className={cn(
              'ml-0.5 size-4 shrink-0 opacity-0 transition-transform group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      )}
      {isBranch && (
        <ul hidden={!expanded} className='mt-0.5 ml-3 space-y-0.5 pl-2'>
          {node.children?.map((child) => (
            <NavigationItem
              key={child.id}
              node={child}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function SidebarNavigation({ nodes, pathname, onNavigate }: SidebarNavigationProps) {
  return (
    <nav aria-label='Documentation sidebar'>
      <ul className='space-y-0.5'>
        {nodes.map((node) => (
          <NavigationItem key={node.id} node={node} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </ul>
    </nav>
  )
}
