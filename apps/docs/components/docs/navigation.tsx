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
  'group flex min-h-[30px] w-full items-center gap-1.5 rounded-lg px-2 py-[5px] text-docs-nav text-[var(--docs-text)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2'

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
  const [prefetch, setPrefetch] = useState(false)
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
      <li className='px-2 pt-4 pb-1.5 text-[var(--docs-muted)] text-docs-caption first:pt-0'>
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
            'group/branch flex min-h-[30px] items-center rounded-lg transition-colors hover:bg-[var(--docs-hover)] active:bg-[var(--docs-pressed)]',
            isCurrent &&
              'bg-[var(--docs-selected)] shadow-[var(--docs-current-edge)] hover:bg-[var(--docs-selected-hover)]'
          )}
        >
          <Link
            href={node.url}
            prefetch={prefetch ? null : false}
            onMouseEnter={() => setPrefetch(true)}
            onFocus={() => setPrefetch(true)}
            onTouchStart={() => setPrefetch(true)}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(rowClass, 'min-w-0 flex-1', isBranch && 'pr-0')}
          >
            {label}
          </Link>
          {isBranch && (
            <button
              type='button'
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
              aria-expanded={expanded}
              onClick={toggle}
              className='mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] group-focus-within/branch:opacity-100 group-hover/branch:opacity-100 [@media(hover:none)]:opacity-100'
            >
              <ChevronDown
                className={cn('size-4 transition-transform', !expanded && '-rotate-90')}
              />
            </button>
          )}
        </div>
      ) : (
        <button
          type='button'
          onClick={toggle}
          aria-expanded={expanded}
          className={cn(rowClass, 'hover:bg-[var(--docs-hover)] active:bg-[var(--docs-pressed)]')}
        >
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
        <ul
          hidden={!expanded}
          className={cn('my-2 ml-3 flex flex-col gap-0.5 pl-2', !expanded && 'hidden')}
        >
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
      <ul className='flex flex-col gap-0.5'>
        {nodes.map((node) => (
          <NavigationItem key={node.id} node={node} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </ul>
    </nav>
  )
}
