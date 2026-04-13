'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertTriangle, LibraryBig, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
import { ChevronDown } from '@/components/emcn/icons'
import { Trash } from '@/components/emcn/icons/trash'
import { filterButtonClass } from '@/app/workspace/[workspaceId]/knowledge/components/constants'
import { useUpdateKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

const logger = createLogger('KnowledgeHeader')

interface BreadcrumbItem {
  label: string
  href?: string
  id?: string
}

const HEADER_STYLES = {
  container: 'flex items-center justify-between px-6 pt-3.5 pb-6',
  breadcrumbs: 'flex items-center gap-2',
  icon: 'h-[18px] w-[18px] text-[var(--text-icon)] transition-colors',
  link: 'group flex items-center gap-2 font-medium text-sm text-[var(--text-body)] transition-colors hover-hover:text-[var(--text-secondary)]',
  label: 'font-medium text-sm text-[var(--text-body)]',
  separator: 'text-[var(--text-icon)]',
  actionsContainer: 'flex items-center gap-2',
} as const

interface KnowledgeHeaderOptions {
  knowledgeBaseId?: string
  currentWorkspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  onDeleteKnowledgeBase?: () => void
}

interface KnowledgeHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  options?: KnowledgeHeaderOptions
}

export function KnowledgeHeader({ breadcrumbs, options }: KnowledgeHeaderProps) {
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false)
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)

  const { data: allWorkspaces = [], isLoading: isLoadingWorkspaces } = useWorkspacesQuery(
    !!options?.knowledgeBaseId
  )
  const workspaces = allWorkspaces.filter(
    (ws) => ws.permissions === 'write' || ws.permissions === 'admin'
  )

  const updateKnowledgeBase = useUpdateKnowledgeBase()

  const handleWorkspaceChange = async (workspaceId: string | null) => {
    if (updateKnowledgeBase.isPending || !options?.knowledgeBaseId) return

    setIsWorkspaceMenuOpen(false)

    updateKnowledgeBase.mutate(
      {
        knowledgeBaseId: options.knowledgeBaseId,
        updates: { workspaceId },
      },
      {
        onSuccess: () => {
          logger.info(
            `Knowledge base workspace updated: ${options.knowledgeBaseId} -> ${workspaceId}`
          )
          options.onWorkspaceChange?.(workspaceId)
        },
        onError: (err) => {
          logger.error('Error updating workspace:', err)
        },
      }
    )
  }

  const currentWorkspace = workspaces.find((ws) => ws.id === options?.currentWorkspaceId)
  const hasWorkspace = !!options?.currentWorkspaceId

  return (
    <div className={HEADER_STYLES.container}>
      <div className={HEADER_STYLES.breadcrumbs}>
        {breadcrumbs.map((breadcrumb, index) => {
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
            <div className='flex items-center gap-2'>
              {/* Warning icon for unassigned knowledge bases */}
              {!hasWorkspace && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <AlertTriangle className='h-4 w-4 text-amber-500' />
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>Not assigned to workspace</Tooltip.Content>
                </Tooltip.Root>
              )}

              {/* Workspace selector dropdown */}
              <DropdownMenu open={isWorkspaceMenuOpen} onOpenChange={setIsWorkspaceMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='outline'
                    disabled={isLoadingWorkspaces || updateKnowledgeBase.isPending}
                    className={filterButtonClass}
                  >
                    <span className='truncate'>
                      {isLoadingWorkspaces
                        ? 'Loading...'
                        : updateKnowledgeBase.isPending
                          ? 'Updating...'
                          : currentWorkspace?.name || 'No workspace'}
                    </span>
                    <ChevronDown className='ml-2 h-4 w-4 text-[var(--text-icon)]' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' side='bottom' sideOffset={4}>
                  <DropdownMenuCheckboxItem
                    checked={!options.currentWorkspaceId}
                    onSelect={() => handleWorkspaceChange(null)}
                  >
                    <span className='text-[var(--text-secondary)]'>No workspace</span>
                  </DropdownMenuCheckboxItem>

                  {workspaces.map((workspace) => (
                    <DropdownMenuCheckboxItem
                      key={workspace.id}
                      checked={options.currentWorkspaceId === workspace.id}
                      onSelect={() => handleWorkspaceChange(workspace.id)}
                    >
                      {workspace.name}
                    </DropdownMenuCheckboxItem>
                  ))}

                  {workspaces.length === 0 && !isLoadingWorkspaces && (
                    <DropdownMenuItem disabled>
                      <span className='text-[var(--text-secondary)] text-xs'>
                        No workspaces with write access
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Actions Menu */}
          {options.onDeleteKnowledgeBase && (
            <DropdownMenu open={isActionsMenuOpen} onOpenChange={setIsActionsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  className={filterButtonClass}
                  aria-label='Knowledge base actions menu'
                >
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' side='bottom' sideOffset={4}>
                <DropdownMenuItem onSelect={() => options.onDeleteKnowledgeBase?.()}>
                  <Trash className='h-4 w-4' />
                  <span>Delete Knowledge Base</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}
