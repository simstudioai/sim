'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertTriangle, ChevronDown, LibraryBig, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { filterButtonClass } from '@/app/workspace/[workspaceId]/knowledge/components/constants'
import { useUpdateKnowledgeBase } from '@/hooks/queries/knowledge'

const logger = createLogger('KnowledgeHeader')

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
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  onDeleteKnowledgeBase?: () => void
}

interface KnowledgeHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  options?: KnowledgeHeaderOptions
}

interface Workspace {
  id: string
  name: string
  permissions: 'admin' | 'write' | 'read'
}

export function KnowledgeHeader({ breadcrumbs, options }: KnowledgeHeaderProps) {
  const [isActionsPopoverOpen, setIsActionsPopoverOpen] = useState(false)
  const [isWorkspacePopoverOpen, setIsWorkspacePopoverOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false)

  const updateKnowledgeBase = useUpdateKnowledgeBase()

  useEffect(() => {
    if (!options?.knowledgeBaseId) return

    const fetchWorkspaces = async () => {
      try {
        setIsLoadingWorkspaces(true)

        const response = await fetch('/api/workspaces')
        if (!response.ok) {
          throw new Error('Failed to fetch workspaces')
        }

        const data = await response.json()

        const availableWorkspaces = data.workspaces
          .filter((ws: any) => ws.permissions === 'write' || ws.permissions === 'admin')
          .map((ws: any) => ({
            id: ws.id,
            name: ws.name,
            permissions: ws.permissions,
          }))

        setWorkspaces(availableWorkspaces)
      } catch (err) {
        logger.error('Error fetching workspaces:', err)
      } finally {
        setIsLoadingWorkspaces(false)
      }
    }

    fetchWorkspaces()
  }, [options?.knowledgeBaseId])

  const handleWorkspaceChange = async (workspaceId: string | null) => {
    if (updateKnowledgeBase.isPending || !options?.knowledgeBaseId) return

    setIsWorkspacePopoverOpen(false)

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
              <Popover open={isWorkspacePopoverOpen} onOpenChange={setIsWorkspacePopoverOpen}>
                <PopoverTrigger asChild>
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
                    <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='end' side='bottom' sideOffset={4}>
                  {/* No workspace option */}
                  <PopoverItem
                    active={!options.currentWorkspaceId}
                    showCheck
                    onClick={() => handleWorkspaceChange(null)}
                  >
                    <span className='text-muted-foreground'>No workspace</span>
                  </PopoverItem>

                  {/* Available workspaces */}
                  {workspaces.map((workspace) => (
                    <PopoverItem
                      key={workspace.id}
                      active={options.currentWorkspaceId === workspace.id}
                      showCheck
                      onClick={() => handleWorkspaceChange(workspace.id)}
                    >
                      {workspace.name}
                    </PopoverItem>
                  ))}

                  {workspaces.length === 0 && !isLoadingWorkspaces && (
                    <PopoverItem disabled>
                      <span className='text-muted-foreground text-xs'>
                        No workspaces with write access
                      </span>
                    </PopoverItem>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Actions Menu */}
          {options.onDeleteKnowledgeBase && (
            <Popover open={isActionsPopoverOpen} onOpenChange={setIsActionsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  className={filterButtonClass}
                  aria-label='Knowledge base actions menu'
                >
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </PopoverTrigger>
              <PopoverContent align='end' side='bottom' sideOffset={4}>
                <PopoverItem
                  onClick={() => {
                    options.onDeleteKnowledgeBase?.()
                    setIsActionsPopoverOpen(false)
                  }}
                  className='text-red-600 hover:text-red-600 focus:text-red-600'
                >
                  <Trash className='h-4 w-4' />
                  <span>Delete Knowledge Base</span>
                </PopoverItem>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  )
}
