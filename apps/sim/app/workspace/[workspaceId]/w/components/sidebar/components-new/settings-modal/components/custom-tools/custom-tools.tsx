'use client'

import { useState } from 'react'
import { AlertCircle, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Label,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { Alert, AlertDescription, Input, Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { CustomToolModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { useCustomTools, useDeleteCustomTool } from '@/hooks/queries/custom-tools'

const logger = createLogger('CustomToolsSettings')

function CustomToolSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-4 w-32' /> {/* Tool title */}
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-24 rounded-[8px]' /> {/* Function name */}
          <Skeleton className='h-4 w-48' /> {/* Description */}
        </div>
        <div className='flex items-center gap-2'>
          <Skeleton className='h-8 w-12' /> {/* Edit button */}
          <Skeleton className='h-8 w-16' /> {/* Delete button */}
        </div>
      </div>
    </div>
  )
}

export function CustomTools() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // React Query hooks
  const { data: tools = [], isLoading, error, refetch: refetchTools } = useCustomTools(workspaceId)
  const deleteToolMutation = useDeleteCustomTool()

  const [searchTerm, setSearchTerm] = useState('')
  const [deletingTools, setDeletingTools] = useState<Set<string>>(new Set())
  const [editingTool, setEditingTool] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [toolToDelete, setToolToDelete] = useState<{ id: string; name: string } | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const filteredTools = tools.filter((tool) => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      tool.title.toLowerCase().includes(searchLower) ||
      tool.schema?.function?.name?.toLowerCase().includes(searchLower) ||
      tool.schema?.function?.description?.toLowerCase().includes(searchLower)
    )
  })

  const handleDeleteClick = (toolId: string) => {
    const tool = tools.find((t) => t.id === toolId)
    if (!tool) return

    setToolToDelete({
      id: toolId,
      name: tool.title || tool.schema?.function?.name || 'this custom tool',
    })
    setShowDeleteDialog(true)
  }

  const handleDeleteTool = async () => {
    if (!toolToDelete) return

    const tool = tools.find((t) => t.id === toolToDelete.id)
    if (!tool) return

    setDeletingTools((prev) => new Set(prev).add(toolToDelete.id))
    setShowDeleteDialog(false)

    try {
      // Pass null workspaceId for user-scoped tools (legacy tools without workspaceId)
      await deleteToolMutation.mutateAsync({
        workspaceId: tool.workspaceId ?? null,
        toolId: toolToDelete.id,
      })
      logger.info(`Deleted custom tool: ${toolToDelete.id}`)
    } catch (error) {
      logger.error('Error deleting custom tool:', error)
    } finally {
      setDeletingTools((prev) => {
        const next = new Set(prev)
        next.delete(toolToDelete.id)
        return next
      })
      setToolToDelete(null)
    }
  }

  const handleToolSaved = () => {
    setShowAddForm(false)
    setEditingTool(null)
    // React Query will automatically refetch via cache invalidation
    refetchTools()
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Fixed Header with Search */}
      <div className='px-6 pt-4 pb-2'>
        {/* Error Alert - only show when modal is not open */}
        {error && !showAddForm && !editingTool && (
          <Alert variant='destructive' className='mb-4'>
            <AlertCircle className='h-4 w-4' />
            <AlertDescription>
              {error instanceof Error ? error.message : 'An error occurred'}
            </AlertDescription>
          </Alert>
        )}

        {/* Search Input */}
        {isLoading ? (
          <Skeleton className='h-9 w-56 rounded-[8px]' />
        ) : (
          <div className='flex h-9 w-56 items-center gap-2 rounded-[8px] border bg-transparent pr-2 pl-3'>
            <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
            <Input
              placeholder='Search tools...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div className='min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='space-y-2 pt-2 pb-6'>
          {isLoading ? (
            <div className='space-y-2'>
              <CustomToolSkeleton />
              <CustomToolSkeleton />
              <CustomToolSkeleton />
            </div>
          ) : tools.length === 0 && !showAddForm && !editingTool ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              Click "Create Tool" below to get started
            </div>
          ) : (
            <>
              <div className='space-y-2'>
                {filteredTools.map((tool) => (
                  <div key={tool.id} className='flex flex-col gap-2'>
                    <Label className='font-normal text-muted-foreground text-xs uppercase'>
                      {tool.title}
                    </Label>
                    <div className='flex items-center justify-between gap-4'>
                      <div className='flex items-center gap-3'>
                        <div className='flex h-8 items-center rounded-[8px] bg-muted px-3'>
                          <code className='font-mono text-foreground text-xs'>
                            {tool.schema?.function?.name || 'unnamed'}
                          </code>
                        </div>
                        {tool.schema?.function?.description && (
                          <p className='truncate text-muted-foreground text-xs'>
                            {tool.schema.function.description}
                          </p>
                        )}
                      </div>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='ghost'
                          onClick={() => setEditingTool(tool.id)}
                          className='h-8'
                        >
                          Edit
                        </Button>
                        <Button
                          variant='ghost'
                          onClick={() => handleDeleteClick(tool.id)}
                          disabled={deletingTools.has(tool.id)}
                          className='h-8'
                        >
                          {deletingTools.has(tool.id) ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Show message when search has no results */}
              {searchTerm.trim() && filteredTools.length === 0 && tools.length > 0 && (
                <div className='py-8 text-center text-muted-foreground text-sm'>
                  No tools found matching "{searchTerm}"
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className='bg-background'>
        <div className='flex w-full items-center justify-between px-6 py-4'>
          {isLoading ? (
            <>
              <Skeleton className='h-9 w-[117px] rounded-[8px]' />
              <div className='w-[200px]' />
            </>
          ) : (
            <>
              <Button
                onClick={() => setShowAddForm(true)}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                disabled={isLoading}
              >
                <Plus className='h-4 w-4 stroke-[2px]' />
                Create Tool
              </Button>
              <div className='text-muted-foreground text-xs'>
                Custom tools extend agent capabilities with workspace-specific functions
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create/Edit Modal - rendered as overlay */}
      <CustomToolModal
        open={showAddForm || !!editingTool}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddForm(false)
            setEditingTool(null)
          }
        }}
        onSave={handleToolSaved}
        onDelete={() => {}}
        blockId=''
        initialValues={
          editingTool
            ? (() => {
                const tool = tools.find((t) => t.id === editingTool)
                return tool?.schema
                  ? { id: tool.id, schema: tool.schema, code: tool.code }
                  : undefined
              })()
            : undefined
        }
      />

      {/* Delete Confirmation Dialog */}
      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete custom tool?</ModalTitle>
            <ModalDescription>
              Deleting "{toolToDelete?.name}" will permanently remove this custom tool from your
              workspace.{' '}
              <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                This action cannot be undone.
              </span>
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button
              className='h-[32px] px-[12px]'
              variant='outline'
              onClick={() => {
                setShowDeleteDialog(false)
                setToolToDelete(null)
              }}
              disabled={deleteToolMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
              onClick={handleDeleteTool}
              disabled={deleteToolMutation.isPending}
            >
              {deleteToolMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
