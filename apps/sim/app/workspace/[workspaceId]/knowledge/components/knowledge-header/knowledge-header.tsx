'use client'

import { LibraryBig, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { Trash } from '@/components/emcn/icons/trash'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WorkspaceSelector } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
} from '@/app/workspace/[workspaceId]/knowledge/components/shared'

interface BreadcrumbItem {
  label: string
  href?: string
  id?: string
}

const HEADER_STYLES = {
  container: 'flex items-center justify-between px-6 pt-[14px] pb-6',
  breadcrumbs: 'flex items-center gap-2',
  icon: 'h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70',
  link: 'group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground',
  label: 'font-medium text-sm',
  separator: 'text-muted-foreground',
  actionsContainer: 'flex items-center gap-2',
} as const

interface KnowledgeHeaderOptions {
  knowledgeBaseId?: string
  currentWorkspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void
  onDeleteKnowledgeBase?: () => void
}

interface KnowledgeHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  options?: KnowledgeHeaderOptions
}

export function KnowledgeHeader({ breadcrumbs, options }: KnowledgeHeaderProps) {
  return (
    <div className={HEADER_STYLES.container}>
      <div className={HEADER_STYLES.breadcrumbs}>
        {breadcrumbs.map((breadcrumb, index) => {
          // Use unique identifier when available, fallback to content-based key
          const key = breadcrumb.id || `${breadcrumb.label}-${breadcrumb.href || index}`

          return (
            <div key={key} className='flex items-center gap-2'>
              {index === 0 && <LibraryBig className={HEADER_STYLES.icon} />}

              {breadcrumb.href ? (
                <Link href={breadcrumb.href} prefetch={true} className={HEADER_STYLES.link}>
                  <span>{breadcrumb.label}</span>
                </Link>
              ) : (
                <span className={HEADER_STYLES.label}>{breadcrumb.label}</span>
              )}

              {index < breadcrumbs.length - 1 && <span className={HEADER_STYLES.separator}>/</span>}
            </div>
          )
        })}
      </div>

      {/* Actions Area */}
      {options && (
        <div className={HEADER_STYLES.actionsContainer}>
          {/* Workspace Selector */}
          {options.knowledgeBaseId && (
            <WorkspaceSelector
              knowledgeBaseId={options.knowledgeBaseId}
              currentWorkspaceId={options.currentWorkspaceId || null}
              onWorkspaceChange={options.onWorkspaceChange}
            />
          )}

          {/* Actions Menu */}
          {options.onDeleteKnowledgeBase && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='sm'
                  className={filterButtonClass}
                  aria-label='Knowledge base actions menu'
                >
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                side='bottom'
                avoidCollisions={false}
                sideOffset={4}
                className={dropdownContentClass}
              >
                <div className={`${commandListClass} py-1`}>
                  <DropdownMenuItem
                    onClick={options.onDeleteKnowledgeBase}
                    className='flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-[380] text-red-600 text-sm hover:bg-secondary/50 focus:bg-secondary/50 focus:text-red-600'
                  >
                    <Trash className='h-4 w-4' />
                    Delete Knowledge Base
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}
