'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Alert, AlertDescription, Button, Input, Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { CustomToolModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/tool-input/components/custom-tool-modal/custom-tool-modal'
import { useCustomToolsStore } from '@/stores/custom-tools/store'

const logger = createLogger('CustomToolsSettings')

function CustomToolSkeleton() {
  return (
    <div className='rounded-[8px] border bg-background p-4'>
      <div className='flex items-center justify-between'>
        <div className='flex-1 space-y-2'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-3 w-48' />
        </div>
        <Skeleton className='h-8 w-20' />
      </div>
    </div>
  )
}

export function CustomTools() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { tools, isLoading, error, fetchTools, deleteTool, clearError } = useCustomToolsStore()

  const [searchTerm, setSearchTerm] = useState('')
  const [deletingTools, setDeletingTools] = useState<Set<string>>(new Set())
  const [editingTool, setEditingTool] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    if (workspaceId) {
      fetchTools(workspaceId)
    }
  }, [workspaceId, fetchTools])

  // Clear store errors when modal opens (errors should show in modal, not in settings)
  useEffect(() => {
    if (showAddForm || editingTool) {
      clearError()
    }
  }, [showAddForm, editingTool, clearError])

  const filteredTools = tools.filter((tool) => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      tool.title.toLowerCase().includes(searchLower) ||
      tool.schema?.function?.name?.toLowerCase().includes(searchLower) ||
      tool.schema?.function?.description?.toLowerCase().includes(searchLower)
    )
  })

  const handleDeleteTool = async (toolId: string) => {
    const tool = tools.find((t) => t.id === toolId)
    if (!tool) return

    setDeletingTools((prev) => new Set(prev).add(toolId))
    try {
      // Pass null workspaceId for user-scoped tools (legacy tools without workspaceId)
      await deleteTool(tool.workspaceId ?? null, toolId)
      logger.info(`Deleted custom tool: ${toolId}`)
      // Silently refresh the list - no toast notification
      if (workspaceId) {
        await fetchTools(workspaceId)
      }
    } catch (error) {
      logger.error('Error deleting custom tool:', error)
      // Silently handle error - no toast notification
    } finally {
      setDeletingTools((prev) => {
        const next = new Set(prev)
        next.delete(toolId)
        return next
      })
    }
  }

  const handleToolSaved = () => {
    setShowAddForm(false)
    setEditingTool(null)
    if (workspaceId) {
      fetchTools(workspaceId)
    }
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div className='border-b px-6 py-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='font-semibold text-foreground text-lg'>Custom Tools</h2>
            <p className='mt-1 text-muted-foreground text-sm'>
              Manage workspace-scoped custom tools for your agents
            </p>
          </div>
          {!showAddForm && !editingTool && (
            <Button size='sm' onClick={() => setShowAddForm(true)} className='h-9'>
              <Plus className='mr-2 h-4 w-4' />
              Add Tool
            </Button>
          )}
        </div>

        {/* Search */}
        {tools.length > 0 && !showAddForm && !editingTool && (
          <div className='mt-4 flex h-9 w-56 items-center gap-2 rounded-lg border bg-transparent pr-2 pl-3'>
            <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
            <Input
              placeholder='Search tools...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
        )}

        {/* Error Alert - only show when modal is not open */}
        {error && !showAddForm && !editingTool && (
          <Alert variant='destructive' className='mt-4'>
            <AlertCircle className='h-4 w-4' />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Scrollable Content */}
      <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='h-full space-y-4 py-2'>
          {isLoading ? (
            <div className='space-y-4'>
              <CustomToolSkeleton />
              <CustomToolSkeleton />
              <CustomToolSkeleton />
            </div>
          ) : filteredTools.length === 0 && !showAddForm && !editingTool ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              {searchTerm.trim() ? (
                <>No tools found matching "{searchTerm}"</>
              ) : (
                <>Click "Add Tool" above to create your first custom tool</>
              )}
            </div>
          ) : (
            <div className='space-y-4'>
              {filteredTools.map((tool) => (
                <div
                  key={tool.id}
                  className='flex items-center justify-between gap-4 rounded-[8px] border bg-background p-4'
                >
                  <div className='min-w-0 flex-1'>
                    <div className='mb-1 flex items-center gap-2'>
                      <code className='font-medium font-mono text-foreground text-sm'>
                        {tool.title}
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
                      size='sm'
                      onClick={() => setEditingTool(tool.id)}
                      className='h-8 text-muted-foreground hover:text-foreground'
                    >
                      Edit
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => handleDeleteTool(tool.id)}
                      disabled={deletingTools.has(tool.id)}
                      className='h-8 text-muted-foreground hover:text-foreground'
                    >
                      {deletingTools.has(tool.id) ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </div>
              ))}
              {searchTerm.trim() && filteredTools.length === 0 && tools.length > 0 && (
                <div className='py-8 text-center text-muted-foreground text-sm'>
                  No tools found matching "{searchTerm}"
                </div>
              )}
            </div>
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
        initialValues={editingTool ? tools.find((t) => t.id === editingTool) : undefined}
      />
    </div>
  )
}
