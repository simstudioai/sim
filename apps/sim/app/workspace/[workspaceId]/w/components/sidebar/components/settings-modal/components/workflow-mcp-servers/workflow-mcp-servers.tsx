'use client'

import { useCallback, useMemo, useState } from 'react'
import { Check, ChevronLeft, Clipboard, Globe, Plus, Search, Server, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import {
  useCreateWorkflowMcpServer,
  useDeleteWorkflowMcpServer,
  useDeleteWorkflowMcpTool,
  usePublishWorkflowMcpServer,
  useUnpublishWorkflowMcpServer,
  useWorkflowMcpServer,
  useWorkflowMcpServers,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/hooks/queries/workflow-mcp-servers'

const logger = createLogger('WorkflowMcpServers')

function ServerSkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px] rounded-[8px] border bg-[var(--surface-3)] p-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[4px]'>
        <Skeleton className='h-[14px] w-[120px]' />
        <Skeleton className='h-[12px] w-[80px]' />
      </div>
      <Skeleton className='h-[28px] w-[60px] rounded-[4px]' />
    </div>
  )
}

interface ServerListItemProps {
  server: WorkflowMcpServer
  onViewDetails: () => void
  onDelete: () => void
  isDeleting: boolean
}

function ServerListItem({ server, onViewDetails, onDelete, isDeleting }: ServerListItemProps) {
  return (
    <div
      className='flex items-center justify-between gap-[12px] rounded-[8px] border bg-[var(--surface-3)] p-[12px] transition-colors hover:bg-[var(--surface-4)]'
      role='button'
      tabIndex={0}
      onClick={onViewDetails}
      onKeyDown={(e) => e.key === 'Enter' && onViewDetails()}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[10px]'>
        <Server className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-tertiary)]' />
        <div className='flex min-w-0 flex-col gap-[2px]'>
          <div className='flex items-center gap-[8px]'>
            <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
              {server.name}
            </span>
            {server.isPublished && (
              <Badge variant='outline' className='flex-shrink-0 text-[10px]'>
                <Globe className='mr-[4px] h-[10px] w-[10px]' />
                Published
              </Badge>
            )}
          </div>
          <span className='text-[12px] text-[var(--text-tertiary)]'>
            {server.toolCount || 0} tool{(server.toolCount || 0) !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <Button
        variant='ghost'
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        disabled={isDeleting}
        className='h-[28px] px-[8px]'
      >
        {isDeleting ? 'Deleting...' : 'Delete'}
      </Button>
    </div>
  )
}

interface ServerDetailViewProps {
  workspaceId: string
  serverId: string
  onBack: () => void
}

function ServerDetailView({ workspaceId, serverId, onBack }: ServerDetailViewProps) {
  const { data, isLoading, error } = useWorkflowMcpServer(workspaceId, serverId)
  const publishMutation = usePublishWorkflowMcpServer()
  const unpublishMutation = useUnpublishWorkflowMcpServer()
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [toolToDelete, setToolToDelete] = useState<WorkflowMcpTool | null>(null)

  const mcpServerUrl = useMemo(() => {
    if (!data?.server?.isPublished) return null
    return `${getBaseUrl()}/api/mcp/serve/${serverId}/sse`
  }, [data?.server?.isPublished, serverId])

  const handlePublish = async () => {
    try {
      await publishMutation.mutateAsync({ workspaceId, serverId })
    } catch (error) {
      logger.error('Failed to publish server:', error)
    }
  }

  const handleUnpublish = async () => {
    try {
      await unpublishMutation.mutateAsync({ workspaceId, serverId })
    } catch (error) {
      logger.error('Failed to unpublish server:', error)
    }
  }

  const handleCopyUrl = () => {
    if (mcpServerUrl) {
      navigator.clipboard.writeText(mcpServerUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    }
  }

  const handleDeleteTool = async () => {
    if (!toolToDelete) return
    try {
      await deleteToolMutation.mutateAsync({
        workspaceId,
        serverId,
        toolId: toolToDelete.id,
      })
      setToolToDelete(null)
    } catch (error) {
      logger.error('Failed to delete tool:', error)
    }
  }

  if (isLoading) {
    return (
      <div className='flex h-full flex-col gap-[16px]'>
        <Skeleton className='h-[24px] w-[200px]' />
        <Skeleton className='h-[100px] w-full' />
        <Skeleton className='h-[150px] w-full' />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-[8px]'>
        <p className='text-[13px] text-[var(--text-error)]'>Failed to load server details</p>
        <Button variant='default' onClick={onBack}>
          Go Back
        </Button>
      </div>
    )
  }

  const { server, tools } = data

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-[16px]'>
            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                Server Name
              </span>
              <p className='text-[14px] text-[var(--text-secondary)]'>{server.name}</p>
            </div>

            {server.description && (
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Description
                </span>
                <p className='text-[14px] text-[var(--text-secondary)]'>{server.description}</p>
              </div>
            )}

            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>Status</span>
              <div className='flex items-center gap-[8px]'>
                {server.isPublished ? (
                  <>
                    <Badge variant='outline' className='text-[12px]'>
                      <Globe className='mr-[4px] h-[12px] w-[12px]' />
                      Published
                    </Badge>
                    <Button
                      variant='ghost'
                      onClick={handleUnpublish}
                      disabled={unpublishMutation.isPending}
                      className='h-[28px] text-[12px]'
                    >
                      {unpublishMutation.isPending ? 'Unpublishing...' : 'Unpublish'}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className='text-[14px] text-[var(--text-tertiary)]'>Not Published</span>
                    <Button
                      variant='default'
                      onClick={handlePublish}
                      disabled={publishMutation.isPending || tools.length === 0}
                      className='h-[28px] text-[12px]'
                    >
                      {publishMutation.isPending ? 'Publishing...' : 'Publish'}
                    </Button>
                  </>
                )}
              </div>
              {publishMutation.isError && (
                <p className='text-[12px] text-[var(--text-error)]'>
                  {publishMutation.error?.message || 'Failed to publish'}
                </p>
              )}
            </div>

            {mcpServerUrl && (
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  MCP Server URL
                </span>
                <div className='flex items-center gap-[8px]'>
                  <code className='flex-1 truncate rounded-[4px] bg-[var(--surface-5)] px-[8px] py-[6px] font-mono text-[12px] text-[var(--text-secondary)]'>
                    {mcpServerUrl}
                  </code>
                  <Button variant='ghost' onClick={handleCopyUrl} className='h-[32px] w-[32px] p-0'>
                    {copiedUrl ? (
                      <Check className='h-[14px] w-[14px]' />
                    ) : (
                      <Clipboard className='h-[14px] w-[14px]' />
                    )}
                  </Button>
                </div>
                <p className='text-[11px] text-[var(--text-tertiary)]'>
                  Use this URL to connect external MCP clients like Cursor or Claude Desktop.
                </p>
              </div>
            )}

            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                Tools ({tools.length})
              </span>
              {tools.length === 0 ? (
                <p className='text-[13px] text-[var(--text-muted)]'>
                  No tools added yet. Deploy a workflow and add it as a tool from the deploy modal.
                </p>
              ) : (
                <div className='flex flex-col gap-[8px]'>
                  {tools.map((tool) => (
                    <div
                      key={tool.id}
                      className='flex items-center justify-between rounded-[6px] border bg-[var(--surface-3)] px-[10px] py-[8px]'
                    >
                      <div className='flex min-w-0 flex-col gap-[2px]'>
                        <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                          {tool.toolName}
                        </p>
                        {tool.toolDescription && (
                          <p className='truncate text-[12px] text-[var(--text-tertiary)]'>
                            {tool.toolDescription}
                          </p>
                        )}
                        {tool.workflowName && (
                          <p className='text-[11px] text-[var(--text-muted)]'>
                            Workflow: {tool.workflowName}
                          </p>
                        )}
                      </div>
                      <Button
                        variant='ghost'
                        onClick={() => setToolToDelete(tool)}
                        className='h-[24px] w-[24px] p-0 text-[var(--text-tertiary)] hover:text-[var(--text-error)]'
                      >
                        <Trash2 className='h-[14px] w-[14px]' />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className='mt-auto flex items-center justify-end'>
          <Button
            onClick={onBack}
            variant='primary'
            className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
          >
            <ChevronLeft className='mr-[4px] h-[14px] w-[14px]' />
            Back
          </Button>
        </div>
      </div>

      <Modal open={!!toolToDelete} onOpenChange={(open) => !open && setToolToDelete(null)}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Remove Tool</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              Are you sure you want to remove{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {toolToDelete?.toolName}
              </span>{' '}
              from this server?
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setToolToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleDeleteTool}
              disabled={deleteToolMutation.isPending}
              className='!bg-[var(--text-error)] !text-white hover:!bg-[var(--text-error)]/90'
            >
              {deleteToolMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

/**
 * Workflow MCP Servers settings component.
 * Allows users to create and manage MCP servers that expose workflows as tools.
 */
export function WorkflowMcpServers() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: servers = [], isLoading, error } = useWorkflowMcpServers(workspaceId)
  const createServerMutation = useCreateWorkflowMcpServer()
  const deleteServerMutation = useDeleteWorkflowMcpServer()

  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({ name: '', description: '' })
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [serverToDelete, setServerToDelete] = useState<WorkflowMcpServer | null>(null)
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())

  const filteredServers = useMemo(() => {
    if (!searchTerm.trim()) return servers
    const search = searchTerm.toLowerCase()
    return servers.filter(
      (server) =>
        server.name.toLowerCase().includes(search) ||
        server.description?.toLowerCase().includes(search)
    )
  }, [servers, searchTerm])

  const resetForm = useCallback(() => {
    setFormData({ name: '', description: '' })
    setShowAddForm(false)
  }, [])

  const handleCreateServer = async () => {
    if (!formData.name.trim()) return

    try {
      await createServerMutation.mutateAsync({
        workspaceId,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
      })
      resetForm()
    } catch (error) {
      logger.error('Failed to create server:', error)
    }
  }

  const handleDeleteServer = async () => {
    if (!serverToDelete) return

    setDeletingServers((prev) => new Set(prev).add(serverToDelete.id))
    setServerToDelete(null)

    try {
      await deleteServerMutation.mutateAsync({
        workspaceId,
        serverId: serverToDelete.id,
      })
    } catch (error) {
      logger.error('Failed to delete server:', error)
    } finally {
      setDeletingServers((prev) => {
        const next = new Set(prev)
        next.delete(serverToDelete.id)
        return next
      })
    }
  }

  const hasServers = servers.length > 0
  const showEmptyState = !hasServers && !showAddForm
  const showNoResults = searchTerm.trim() && filteredServers.length === 0 && hasServers
  const isFormValid = formData.name.trim().length > 0

  // Show detail view if a server is selected
  if (selectedServerId) {
    return (
      <ServerDetailView
        workspaceId={workspaceId}
        serverId={selectedServerId}
        onBack={() => setSelectedServerId(null)}
      />
    )
  }

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div
            className={cn(
              'flex flex-1 items-center gap-[8px] rounded-[8px] border bg-[var(--surface-6)] px-[8px] py-[5px]',
              isLoading && 'opacity-50'
            )}
          >
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search servers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-100'
            />
          </div>
          <Button
            onClick={() => setShowAddForm(true)}
            disabled={isLoading}
            variant='primary'
            className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
          >
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        {showAddForm && (
          <div className='rounded-[8px] border bg-[var(--surface-3)] p-[12px]'>
            <div className='flex flex-col gap-[12px]'>
              <div className='flex flex-col gap-[6px]'>
                <label
                  htmlFor='mcp-server-name'
                  className='font-medium text-[13px] text-[var(--text-secondary)]'
                >
                  Server Name
                </label>
                <EmcnInput
                  id='mcp-server-name'
                  placeholder='e.g., My Workflow Tools'
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className='h-9'
                />
              </div>

              <div className='flex flex-col gap-[6px]'>
                <label
                  htmlFor='mcp-server-description'
                  className='font-medium text-[13px] text-[var(--text-secondary)]'
                >
                  Description (optional)
                </label>
                <EmcnInput
                  id='mcp-server-description'
                  placeholder='Describe what this server provides...'
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  className='h-9'
                />
              </div>

              <div className='flex items-center justify-end gap-[8px] pt-[4px]'>
                <Button variant='ghost' onClick={resetForm}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateServer}
                  disabled={!isFormValid || createServerMutation.isPending}
                  className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
                >
                  {createServerMutation.isPending ? 'Creating...' : 'Create Server'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-[8px]'>
              <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {error instanceof Error ? error.message : 'Failed to load servers'}
              </p>
            </div>
          ) : isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              <ServerSkeleton />
              <ServerSkeleton />
            </div>
          ) : showEmptyState ? (
            <div className='flex h-full flex-col items-center justify-center gap-[8px] text-center'>
              <Server className='h-[32px] w-[32px] text-[var(--text-muted)]' />
              <p className='text-[13px] text-[var(--text-muted)]'>
                No workflow MCP servers yet.
                <br />
                Create one to expose your workflows as MCP tools.
              </p>
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredServers.map((server) => (
                <ServerListItem
                  key={server.id}
                  server={server}
                  onViewDetails={() => setSelectedServerId(server.id)}
                  onDelete={() => setServerToDelete(server)}
                  isDeleting={deletingServers.has(server.id)}
                />
              ))}
              {showNoResults && (
                <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                  No servers found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!serverToDelete} onOpenChange={(open) => !open && setServerToDelete(null)}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Delete MCP Server</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{serverToDelete?.name}</span>
              ?{' '}
              <span className='text-[var(--text-error)]'>
                This will remove all tools and cannot be undone.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setServerToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleDeleteServer}
              className='!bg-[var(--text-error)] !text-white hover:!bg-[var(--text-error)]/90'
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
