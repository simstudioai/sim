'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Chip,
  ChipConfirmModal,
  ChipInput,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Search,
} from '@/components/emcn'
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
            <ChipInput
              icon={Search}
              placeholder='Search tools...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
            />

            {error ? (
              <div className='flex h-full flex-col items-center justify-center gap-2'>
                <p className='text-[var(--text-error)] text-sm leading-tight'>
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
                      <span className='truncate text-[14px] text-[var(--text-body)]'>
                        {tool.title || 'Unnamed Tool'}
                      </span>
                      {tool.schema?.function?.description && (
                        <p className='truncate text-[12px] text-[var(--text-muted)]'>
                          {tool.schema.function.description}
                        </p>
                      )}
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-1'>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type='button'
                            aria-label='Tool actions'
                            className={chipVariants({ flush: true })}
                          >
                            <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem onSelect={() => setEditingTool(tool.id)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className='text-[var(--text-error)]'
                            onSelect={() => handleDeleteClick(tool.id)}
                            disabled={deletingTools.has(tool.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      <ChipConfirmModal
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) setShowDeleteDialog(false)
        }}
        srTitle='Delete Custom Tool'
        title='Delete Custom Tool'
        text={[
          'Are you sure you want to delete ',
          { text: toolToDelete?.name ?? 'this tool', bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{ label: 'Delete', onClick: handleDeleteTool }}
      />
    </>
  )
}
