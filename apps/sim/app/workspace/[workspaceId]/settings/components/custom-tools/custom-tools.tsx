'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Chip, ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader } from '@/components/emcn'
import { Input } from '@/components/ui'
import { CustomToolModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { useCustomTools, useDeleteCustomTool } from '@/hooks/queries/custom-tools'

const logger = createLogger('CustomToolsSettings')

export function CustomTools() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: tools = [], isLoading, error, refetch: refetchTools } = useCustomTools(workspaceId)
  const deleteToolMutation = useDeleteCustomTool()

  const [searchTerm, setSearchTerm] = useState('')
  const [deletingTools, setDeletingTools] = useState<Set<string>>(() => new Set())
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
    refetchTools()
  }

  const hasTools = tools && tools.length > 0
  const showEmptyState = !hasTools && !showAddForm && !editingTool
  const showNoResults = searchTerm.trim() && filteredTools.length === 0 && tools.length > 0

  return (
    <>
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
          <div />
          <div className='flex items-center'>
            <Chip
              leftIcon={Plus}
              variant='primary'
              onClick={() => setShowAddForm(true)}
              disabled={isLoading}
            >
              Add Tool
            </Chip>
          </div>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col gap-4.5 pt-4 pb-6'>
            <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
              <Search
                className='size-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
                strokeWidth={2}
              />
              <Input
                placeholder='Search tools...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={isLoading}
                className='h-auto flex-1 border-0 bg-transparent p-0 leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>

            {error ? (
              <div className='flex h-full flex-col items-center justify-center gap-2'>
                <p className='text-[var(--error)] text-xs leading-tight dark:text-[var(--error)]'>
                  {getErrorMessage(error, 'Failed to load tools')}
                </p>
              </div>
            ) : isLoading ? null : showEmptyState ? (
              <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
                Click "Add Tool" above to get started
              </div>
            ) : (
              <div className='flex flex-col gap-2'>
                {filteredTools.map((tool) => (
                  <div key={tool.id} className='flex items-center justify-between gap-3'>
                    <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                      <span className='truncate font-medium text-base'>
                        {tool.title || 'Unnamed Tool'}
                      </span>
                      {tool.schema?.function?.description && (
                        <p className='truncate text-[var(--text-muted)] text-sm'>
                          {tool.schema.function.description}
                        </p>
                      )}
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-2'>
                      <Chip onClick={() => setEditingTool(tool.id)}>Edit</Chip>
                      <Chip
                        onClick={() => handleDeleteClick(tool.id)}
                        disabled={deletingTools.has(tool.id)}
                      >
                        {deletingTools.has(tool.id) ? 'Deleting...' : 'Delete'}
                      </Chip>
                    </div>
                  </div>
                ))}
                {showNoResults && (
                  <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                    No tools found matching "{searchTerm}"
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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

      <ChipModal
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        srTitle='Delete Custom Tool'
      >
        <ChipModalHeader showDivider={false}>Delete Custom Tool</ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{toolToDelete?.name}</span>?{' '}
            This action cannot be undone.
          </p>
        </ChipModalBody>
        <ChipModalFooter>
          <Chip variant='filled' flush onClick={() => setShowDeleteDialog(false)}>
            Cancel
          </Chip>
          <Chip variant='destructive' flush onClick={handleDeleteTool}>
            Delete
          </Chip>
        </ChipModalFooter>
      </ChipModal>
    </>
  )
}
