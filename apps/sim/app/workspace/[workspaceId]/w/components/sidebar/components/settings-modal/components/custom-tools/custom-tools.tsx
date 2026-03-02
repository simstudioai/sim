'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { CustomToolModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { useCustomTools, useDeleteCustomTool } from '@/hooks/queries/custom-tools'

const logger = createLogger('CustomToolsSettings')

function CustomToolSkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <Skeleton className='h-[13px] w-[200px]' />
      </div>
      <div className='flex flex-shrink-0 items-center gap-[8px]'>
        <Skeleton className='h-[30px] w-[40px] rounded-[4px]' />
        <Skeleton className='h-[30px] w-[54px] rounded-[4px]' />
      </div>
    </div>
  )
}

export function CustomTools() {
  const t = useTranslations()
  const params = useParams()
  const workspaceId = params.workspaceId as string

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
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder={t('settings.custom_tools.placeholders.search')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button onClick={() => setShowAddForm(true)} disabled={isLoading} variant='tertiary'>
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            {t('settings.custom_tools.buttons.add')}
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-[8px]'>
              <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {error instanceof Error
                  ? error.message
                  : t('settings.custom_tools.errors.failed_to_load')}
              </p>
            </div>
          ) : isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              <CustomToolSkeleton />
              <CustomToolSkeleton />
              <CustomToolSkeleton />
            </div>
          ) : showEmptyState ? (
            <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
              {t('settings.custom_tools.empty_state')}
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredTools.map((tool) => (
                <div key={tool.id} className='flex items-center justify-between gap-[12px]'>
                  <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                    <span className='truncate font-medium text-[14px]'>
                      {tool.title || t('settings.custom_tools.unnamed_tool')}
                    </span>
                    {tool.schema?.function?.description && (
                      <p className='truncate text-[13px] text-[var(--text-muted)]'>
                        {tool.schema.function.description}
                      </p>
                    )}
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-[8px]'>
                    <Button variant='default' onClick={() => setEditingTool(tool.id)}>
                      {t('settings.custom_tools.buttons.edit')}
                    </Button>
                    <Button
                      variant='ghost'
                      onClick={() => handleDeleteClick(tool.id)}
                      disabled={deletingTools.has(tool.id)}
                    >
                      {deletingTools.has(tool.id)
                        ? t('settings.custom_tools.buttons.deleting')
                        : t('settings.custom_tools.buttons.delete')}
                    </Button>
                  </div>
                </div>
              ))}
              {showNoResults && (
                <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                  {t('settings.custom_tools.no_results', { searchTerm })}
                </div>
              )}
            </div>
          )}
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

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>{t('settings.custom_tools.delete_dialog.title')}</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {t.rich('settings.custom_tools.delete_dialog.confirm_message', {
                toolName: toolToDelete?.name,
                name: (chunks) => (
                  <span className='font-medium text-[var(--text-primary)]'>{chunks}</span>
                ),
                warning: (chunks) => <span className='text-[var(--text-error)]'>{chunks}</span>,
              })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDeleteDialog(false)}>
              {t('settings.custom_tools.buttons.cancel')}
            </Button>
            <Button variant='destructive' onClick={handleDeleteTool}>
              {t('settings.custom_tools.buttons.delete')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
