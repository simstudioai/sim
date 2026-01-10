'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Clipboard, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input as EmcnInput,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  useAddWorkflowMcpTool,
  useCreateWorkflowMcpServer,
  useDeleteWorkflowMcpServer,
  useDeleteWorkflowMcpTool,
  useDeployedWorkflows,
  useUpdateWorkflowMcpTool,
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
  const { data, isLoading, error, refetch } = useWorkflowMcpServer(workspaceId, serverId)
  const { data: deployedWorkflows = [], isLoading: isLoadingWorkflows } =
    useDeployedWorkflows(workspaceId)
  const deleteToolMutation = useDeleteWorkflowMcpTool()
  const addToolMutation = useAddWorkflowMcpTool()
  const updateToolMutation = useUpdateWorkflowMcpTool()
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [toolToDelete, setToolToDelete] = useState<WorkflowMcpTool | null>(null)
  const [toolToView, setToolToView] = useState<WorkflowMcpTool | null>(null)
  const [editingDescription, setEditingDescription] = useState<string>('')
  const [showAddWorkflow, setShowAddWorkflow] = useState(false)

  useEffect(() => {
    if (toolToView) {
      setEditingDescription(toolToView.toolDescription || '')
    }
  }, [toolToView])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)

  const mcpServerUrl = useMemo(() => {
    return `${getBaseUrl()}/api/mcp/serve/${serverId}`
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

  const handleAddWorkflow = async () => {
    if (!selectedWorkflowId) return
    try {
      await addToolMutation.mutateAsync({
        workspaceId,
        serverId,
        workflowId: selectedWorkflowId,
      })
      setShowAddWorkflow(false)
      setSelectedWorkflowId(null)
      refetch()
    } catch (err) {
      logger.error('Failed to add workflow:', err)
    }
  }

  const tools = data?.tools ?? []

  const availableWorkflows = useMemo(() => {
    const existingWorkflowIds = new Set(tools.map((t) => t.workflowId))
    return deployedWorkflows.filter((w) => !existingWorkflowIds.has(w.id))
  }, [deployedWorkflows, tools])

  const workflowOptions: ComboboxOption[] = useMemo(() => {
    return availableWorkflows.map((w) => ({
      label: w.name,
      value: w.id,
    }))
  }, [availableWorkflows])

  const selectedWorkflow = useMemo(() => {
    return availableWorkflows.find((w) => w.id === selectedWorkflowId)
  }, [availableWorkflows, selectedWorkflowId])

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

  const { server } = data

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
                <p className='flex-1 break-all text-[14px] text-[var(--text-secondary)]'>
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
              <div className='flex items-center justify-between'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Workflows ({tools.length})
                </span>
                <Button
                  variant='tertiary'
                  onClick={() => setShowAddWorkflow(true)}
                  disabled={availableWorkflows.length === 0}
                >
                  <Plus className='mr-[6px] h-[13px] w-[13px]' />
                  Add
                </Button>
              </div>

              {tools.length === 0 ? (
                <p className='text-[13px] text-[var(--text-muted)]'>
                  No workflows added yet. Click "Add" to add a deployed workflow.
                </p>
              ) : (
                <div className='flex flex-col gap-[8px]'>
                  {tools.map((tool) => (
                    <div key={tool.id} className='flex items-center justify-between gap-[12px]'>
                      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                        <span className='font-medium text-[14px]'>{tool.toolName}</span>
                        <p className='truncate text-[13px] text-[var(--text-muted)]'>
                          {tool.toolDescription || 'No description'}
                        </p>
                      </div>
                      <div className='flex flex-shrink-0 items-center gap-[4px]'>
                        <Button variant='default' onClick={() => setToolToView(tool)}>
                          Details
                        </Button>
                        <Button
                          variant='ghost'
                          onClick={() => setToolToDelete(tool)}
                          disabled={deleteToolMutation.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {availableWorkflows.length === 0 && deployedWorkflows.length > 0 && (
                <p className='mt-[4px] text-[11px] text-[var(--text-muted)]'>
                  All deployed workflows have been added to this server.
                </p>
              )}
              {deployedWorkflows.length === 0 && !isLoadingWorkflows && (
                <p className='mt-[4px] text-[11px] text-[var(--text-muted)]'>
                  Deploy a workflow first to add it to this server.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className='mt-auto flex items-center justify-end'>
          <Button onClick={onBack} variant='tertiary'>
            Back
          </Button>
        </div>
      </div>

      <Modal open={!!toolToDelete} onOpenChange={(open) => !open && setToolToDelete(null)}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Remove Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to remove{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {toolToDelete?.toolName}
              </span>{' '}
              from this server? The workflow will remain deployed and can be added back later.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setToolToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDeleteTool}
              disabled={deleteToolMutation.isPending}
            >
              {deleteToolMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={!!toolToView}
        onOpenChange={(open) => {
          if (!open) {
            setToolToView(null)
            setEditingDescription('')
          }
        }}
      >
        <ModalContent className='w-[480px]'>
          <ModalHeader>{toolToView?.toolName}</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Description
                </span>
                <Textarea
                  value={editingDescription}
                  onChange={(e) => setEditingDescription(e.target.value)}
                  placeholder='Describe what this tool does...'
                  className='min-h-[80px] resize-none'
                />
              </div>

              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Parameters
                </span>
                {(() => {
                  const schema = toolToView?.parameterSchema as
                    | { properties?: Record<string, { type?: string; description?: string }> }
                    | undefined
                  const properties = schema?.properties
                  if (!properties || Object.keys(properties).length === 0) {
                    return <p className='text-[13px] text-[var(--text-muted)]'>No parameters</p>
                  }
                  return (
                    <div className='flex flex-col gap-[8px]'>
                      {Object.entries(properties).map(([name, prop]) => (
                        <div
                          key={name}
                          className='rounded-[6px] border bg-[var(--surface-3)] px-[10px] py-[8px]'
                        >
                          <div className='flex items-center justify-between'>
                            <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                              {name}
                            </span>
                            <Badge variant='outline' size='sm'>
                              {prop.type || 'any'}
                            </Badge>
                          </div>
                          {prop.description && (
                            <p className='mt-[4px] text-[12px] text-[var(--text-muted)]'>
                              {prop.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setToolToView(null)}>
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={async () => {
                if (!toolToView) return
                try {
                  await updateToolMutation.mutateAsync({
                    workspaceId,
                    serverId,
                    toolId: toolToView.id,
                    toolDescription: editingDescription.trim() || undefined,
                  })
                  refetch()
                  setToolToView(null)
                  setEditingDescription('')
                } catch (err) {
                  logger.error('Failed to update tool description:', err)
                }
              }}
              disabled={
                updateToolMutation.isPending ||
                editingDescription.trim() === (toolToView?.toolDescription || '')
              }
            >
              {updateToolMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={showAddWorkflow}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddWorkflow(false)
            setSelectedWorkflowId(null)
          }
        }}
      >
        <ModalContent className='w-[420px]'>
          <ModalHeader>Add Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Select a deployed workflow to add to this MCP server. The workflow will be available
              as a tool.
            </p>

            <div className='mt-[16px] flex flex-col gap-[8px]'>
              <Label className='font-medium text-[13px] text-[var(--text-secondary)]'>
                Select Workflow
              </Label>
              <Combobox
                options={workflowOptions}
                value={selectedWorkflowId || undefined}
                onChange={(value: string) => setSelectedWorkflowId(value)}
                placeholder='Select a workflow...'
                searchable
                searchPlaceholder='Search workflows...'
                disabled={addToolMutation.isPending}
                overlayContent={
                  selectedWorkflow ? (
                    <span className='truncate text-[var(--text-primary)]'>
                      {selectedWorkflow.name}
                    </span>
                  ) : undefined
                }
              />
              {addToolMutation.isError && (
                <p className='text-[11px] text-[var(--text-error)] leading-tight'>
                  {addToolMutation.error?.message || 'Failed to add workflow'}
                </p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setShowAddWorkflow(false)
                setSelectedWorkflowId(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleAddWorkflow}
              disabled={!selectedWorkflowId || addToolMutation.isPending}
            >
              {addToolMutation.isPending ? 'Adding...' : 'Add Workflow'}
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
      await createServerMutation.mutateAsync({
        workspaceId,
        name: formData.name.trim(),
      })
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
  const shouldShowForm = showAddForm || !hasServers
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
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
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
          <Button onClick={() => setShowAddForm(true)} disabled={isLoading} variant='tertiary'>
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        {shouldShowForm && !isLoading && (
          <div className='rounded-[8px] border p-[10px]'>
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
                  variant='tertiary'
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
                      <Button variant='default' onClick={() => setSelectedServerId(server.id)}>
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
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{serverToDelete?.name}</span>
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setServerToDelete(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteServer}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
