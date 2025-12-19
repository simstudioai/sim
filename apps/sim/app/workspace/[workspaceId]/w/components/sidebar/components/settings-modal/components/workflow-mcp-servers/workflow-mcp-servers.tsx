'use client'

import { useCallback, useMemo, useState } from 'react'
import { Check, Clipboard, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import {
  useCreateWorkflowMcpServer,
  useDeleteWorkflowMcpServer,
  useDeleteWorkflowMcpTool,
  usePublishWorkflowMcpServer,
  useWorkflowMcpServer,
  useWorkflowMcpServers,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/hooks/queries/workflow-mcp-servers'
import { FormField, McpServerSkeleton } from '../mcp/components'

const logger = createLogger('WorkflowMcpServers')

interface ServerDetailViewProps {
  workspaceId: string
  serverId: string
  onBack: () => void
}

function ServerDetailView({ workspaceId, serverId, onBack }: ServerDetailViewProps) {
  const { data, isLoading, error } = useWorkflowMcpServer(workspaceId, serverId)
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [toolToDelete, setToolToDelete] = useState<WorkflowMcpTool | null>(null)

  const mcpServerUrl = useMemo(() => {
    return `${getBaseUrl()}/api/mcp/serve/${serverId}/sse`
  }, [serverId])

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(mcpServerUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
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
    } catch (err) {
      logger.error('Failed to delete tool:', err)
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
        <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
          Failed to load server details
        </p>
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

            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>Transport</span>
              <p className='text-[14px] text-[var(--text-secondary)]'>Streamable-HTTP</p>
            </div>

            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>URL</span>
              <div className='flex items-center gap-[8px]'>
                <p className='flex-1 break-all font-mono text-[13px] text-[var(--text-secondary)]'>
                  {mcpServerUrl}
                </p>
                <Button variant='ghost' onClick={handleCopyUrl} className='h-[32px] w-[32px] p-0'>
                  {copiedUrl ? (
                    <Check className='h-[14px] w-[14px]' />
                  ) : (
                    <Clipboard className='h-[14px] w-[14px]' />
                  )}
                </Button>
              </div>
            </div>

            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                Tools ({tools.length})
              </span>
              {tools.length === 0 ? (
                <p className='text-[13px] text-[var(--text-muted)]'>No tools available</p>
              ) : (
                <div className='flex flex-col gap-[8px]'>
                  {tools.map((tool) => (
                    <div
                      key={tool.id}
                      className='rounded-[6px] border bg-[var(--surface-3)] px-[10px] py-[8px]'
                    >
                      <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                        {tool.toolName}
                      </p>
                      {tool.toolDescription && (
                        <p className='mt-[4px] text-[13px] text-[var(--text-tertiary)]'>
                          {tool.toolDescription}
                        </p>
                      )}
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
 * MCP Servers settings component.
 * Allows users to create and manage MCP servers that expose workflows as tools.
 */
export function WorkflowMcpServers() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: servers = [], isLoading, error } = useWorkflowMcpServers(workspaceId)
  const createServerMutation = useCreateWorkflowMcpServer()
  const publishServerMutation = usePublishWorkflowMcpServer()
  const deleteServerMutation = useDeleteWorkflowMcpServer()

  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({ name: '' })
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [serverToDelete, setServerToDelete] = useState<WorkflowMcpServer | null>(null)
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())

  const filteredServers = useMemo(() => {
    if (!searchTerm.trim()) return servers
    const search = searchTerm.toLowerCase()
    return servers.filter((server) => server.name.toLowerCase().includes(search))
  }, [servers, searchTerm])

  const resetForm = useCallback(() => {
    setFormData({ name: '' })
    setShowAddForm(false)
  }, [])

  const handleCreateServer = async () => {
    if (!formData.name.trim()) return

    try {
      const server = await createServerMutation.mutateAsync({
        workspaceId,
        name: formData.name.trim(),
      })
      // Auto-publish the server
      if (server?.id) {
        await publishServerMutation.mutateAsync({
          workspaceId,
          serverId: server.id,
        })
      }
      resetForm()
    } catch (err) {
      logger.error('Failed to create server:', err)
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
    } catch (err) {
      logger.error('Failed to delete server:', err)
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
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border bg-[var(--surface-6)] px-[8px] py-[5px]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search servers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
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

        {showAddForm && !isLoading && (
          <div className='rounded-[8px] border bg-[var(--surface-3)] p-[10px]'>
            <div className='flex flex-col gap-[8px]'>
              <FormField label='Server Name'>
                <EmcnInput
                  placeholder='e.g., My MCP Server'
                  value={formData.name}
                  onChange={(e) => setFormData({ name: e.target.value })}
                  className='h-9'
                />
              </FormField>

              <div className='flex items-center justify-end gap-[8px] pt-[12px]'>
                <Button variant='ghost' onClick={resetForm}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateServer}
                  disabled={!isFormValid || createServerMutation.isPending}
                  className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
                >
                  {createServerMutation.isPending ? 'Adding...' : 'Add Server'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-[8px]'>
              <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {error instanceof Error ? error.message : 'Failed to load MCP servers'}
              </p>
            </div>
          ) : isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              <McpServerSkeleton />
              <McpServerSkeleton />
              <McpServerSkeleton />
            </div>
          ) : showEmptyState ? (
            <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
              Click "Add" above to get started
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredServers.map((server) => {
                const count = server.toolCount || 0
                const toolNames = server.toolNames || []
                const names = count > 0 ? `: ${toolNames.join(', ')}` : ''
                const toolsLabel = `${count} tool${count !== 1 ? 's' : ''}${names}`
                const isDeleting = deletingServers.has(server.id)
                return (
                  <div key={server.id} className='flex items-center justify-between gap-[12px]'>
                    <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                      <div className='flex items-center gap-[6px]'>
                        <span className='max-w-[200px] truncate font-medium text-[14px]'>
                          {server.name}
                        </span>
                        <span className='text-[13px] text-[var(--text-secondary)]'>
                          (Streamable-HTTP)
                        </span>
                      </div>
                      <p className='truncate text-[13px] text-[var(--text-muted)]'>{toolsLabel}</p>
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-[4px]'>
                      <Button
                        variant='primary'
                        onClick={() => setSelectedServerId(server.id)}
                        className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
                      >
                        Details
                      </Button>
                      <Button
                        variant='ghost'
                        onClick={() => setServerToDelete(server)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                )
              })}
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
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
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
