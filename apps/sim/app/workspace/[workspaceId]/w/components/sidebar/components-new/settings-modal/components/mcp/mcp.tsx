'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Input as EmcnInput } from '@/components/emcn'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components/modal/modal'
import { Input } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { checkEnvVarTrigger } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useMcpToolsQuery,
} from '@/hooks/queries/mcp'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import type { InputFieldType, McpServerFormData, McpServerTestResult } from './components'
import {
  FormattedInput,
  FormField,
  HeaderRow,
  McpServerSkeleton,
  ServerListItem,
} from './components'

const logger = createLogger('McpSettings')

const DEFAULT_FORM_DATA: McpServerFormData = {
  name: '',
  transport: 'streamable-http',
  url: '',
  timeout: 30000,
  headers: [{ key: '', value: '' }],
}

/**
 * Determines the label for the test connection button based on current state.
 */
function getTestButtonLabel(
  testResult: McpServerTestResult | null,
  isTestingConnection: boolean
): string {
  if (isTestingConnection) return 'Testing...'
  if (testResult?.success) return 'Connection success'
  if (testResult && !testResult.success) return 'No connection: retry'
  return 'Test Connection'
}

/**
 * MCP Settings component for managing Model Context Protocol servers.
 * Handles server CRUD operations, connection testing, and environment variable integration.
 */
export function MCP() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    data: servers = [],
    isLoading: serversLoading,
    error: serversError,
  } = useMcpServers(workspaceId)
  const { data: mcpToolsData = [], error: toolsError } = useMcpToolsQuery(workspaceId)
  const createServerMutation = useCreateMcpServer()
  const deleteServerMutation = useDeleteMcpServer()
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  const urlInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)
  const [isAddingServer, setIsAddingServer] = useState(false)

  // Search and filtering state
  const [searchTerm, setSearchTerm] = useState('')
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())

  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<{ id: string; name: string } | null>(null)

  // Environment variable dropdown state
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envSearchTerm, setEnvSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<InputFieldType | null>(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)

  // Scroll position state for formatted text overlays
  const [urlScrollLeft, setUrlScrollLeft] = useState(0)
  const [headerScrollLeft, setHeaderScrollLeft] = useState<Record<string, number>>({})

  /**
   * Resets environment variable dropdown state.
   */
  const resetEnvVarState = useCallback(() => {
    setShowEnvVars(false)
    setActiveInputField(null)
    setActiveHeaderIndex(null)
  }, [])

  /**
   * Resets the form to its default state.
   */
  const resetForm = useCallback(() => {
    setFormData(DEFAULT_FORM_DATA)
    setShowAddForm(false)
    resetEnvVarState()
    clearTestResult()
  }, [clearTestResult, resetEnvVarState])

  /**
   * Updates a header field at the specified index.
   */
  const updateHeader = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setFormData((prev) => {
      const newHeaders = [...(prev.headers || [])]
      if (newHeaders[index]) {
        newHeaders[index] = { ...newHeaders[index], [field]: value }
      }
      return { ...prev, headers: newHeaders }
    })
  }, [])

  /**
   * Handles environment variable selection and updates the appropriate field.
   */
  const handleEnvVarSelect = useCallback(
    (newValue: string) => {
      if (activeInputField === 'url') {
        setFormData((prev) => ({ ...prev, url: newValue }))
      } else if (activeHeaderIndex !== null) {
        const field = activeInputField === 'header-key' ? 'key' : 'value'
        const processedValue = field === 'key' ? newValue.replace(/[{}]/g, '') : newValue
        updateHeader(activeHeaderIndex, field, processedValue)
      }
      resetEnvVarState()
    },
    [activeInputField, activeHeaderIndex, updateHeader, resetEnvVarState]
  )

  /**
   * Handles input changes and manages environment variable dropdown visibility.
   */
  const handleInputChange = useCallback(
    (field: InputFieldType, value: string, headerIndex?: number) => {
      const input = document.activeElement as HTMLInputElement
      const pos = input?.selectionStart || 0

      setCursorPosition(pos)

      if (testResult) {
        clearTestResult()
      }

      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setShowEnvVars(envVarTrigger.show)
      setEnvSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      if (envVarTrigger.show) {
        setActiveInputField(field)
        setActiveHeaderIndex(headerIndex ?? null)
      } else {
        resetEnvVarState()
      }

      if (field === 'url') {
        setFormData((prev) => ({ ...prev, url: value }))
      } else if (headerIndex !== undefined) {
        const headerField = field === 'header-key' ? 'key' : 'value'
        updateHeader(headerIndex, headerField, value)
      }
    },
    [testResult, clearTestResult, updateHeader, resetEnvVarState]
  )

  /**
   * Converts headers array to Record format for API calls.
   * Filters out entries with empty keys.
   */
  const headersToRecord = useCallback(
    (headers: typeof formData.headers): Record<string, string> => {
      const record: Record<string, string> = {}
      for (const header of headers || []) {
        if (header.key.trim()) {
          record[header.key] = header.value
        }
      }
      return record
    },
    []
  )

  /**
   * Tests the connection to the MCP server with current form data.
   */
  const handleTestConnection = useCallback(async () => {
    if (!formData.name.trim() || !formData.url?.trim()) return

    await testConnection({
      name: formData.name,
      transport: formData.transport,
      url: formData.url,
      headers: headersToRecord(formData.headers),
      timeout: formData.timeout,
      workspaceId,
    })
  }, [formData, testConnection, workspaceId, headersToRecord])

  /**
   * Adds a new MCP server after validating and testing the connection.
   */
  const handleAddServer = useCallback(async () => {
    if (!formData.name.trim()) return

    setIsAddingServer(true)
    try {
      const headersRecord = headersToRecord(formData.headers)
      const serverConfig = {
        name: formData.name,
        transport: formData.transport,
        url: formData.url,
        headers: headersRecord,
        timeout: formData.timeout,
        workspaceId,
      }

      // Test connection if not already tested
      if (!testResult) {
        const result = await testConnection(serverConfig)
        if (!result.success) return
      }

      if (testResult && !testResult.success) return

      await createServerMutation.mutateAsync({
        workspaceId,
        config: {
          name: formData.name.trim(),
          transport: formData.transport,
          url: formData.url,
          timeout: formData.timeout || 30000,
          headers: headersRecord,
          enabled: true,
        },
      })

      logger.info(`Added MCP server: ${formData.name}`)
      resetForm()
    } catch (error) {
      logger.error('Failed to add MCP server:', error)
    } finally {
      setIsAddingServer(false)
    }
  }, [
    formData,
    testResult,
    testConnection,
    createServerMutation,
    workspaceId,
    headersToRecord,
    resetForm,
  ])

  /**
   * Opens the delete confirmation dialog for an MCP server.
   */
  const handleRemoveServer = useCallback((serverId: string, serverName: string) => {
    setServerToDelete({ id: serverId, name: serverName })
    setShowDeleteDialog(true)
  }, [])

  /**
   * Confirms and executes the server deletion.
   */
  const confirmDeleteServer = useCallback(async () => {
    if (!serverToDelete) return

    setShowDeleteDialog(false)
    const { id: serverId, name: serverName } = serverToDelete
    setServerToDelete(null)

    setDeletingServers((prev) => new Set(prev).add(serverId))

    try {
      await deleteServerMutation.mutateAsync({ workspaceId, serverId })
      logger.info(`Removed MCP server: ${serverName}`)
    } catch (error) {
      logger.error('Failed to remove MCP server:', error)
    } finally {
      setDeletingServers((prev) => {
        const newSet = new Set(prev)
        newSet.delete(serverId)
        return newSet
      })
    }
  }, [serverToDelete, deleteServerMutation, workspaceId])

  /**
   * Groups tools by their server ID for display.
   */
  const toolsByServer = useMemo(() => {
    return (mcpToolsData || []).reduce(
      (acc, tool) => {
        if (!tool?.serverId) return acc
        if (!acc[tool.serverId]) {
          acc[tool.serverId] = []
        }
        acc[tool.serverId].push(tool)
        return acc
      },
      {} as Record<string, typeof mcpToolsData>
    )
  }, [mcpToolsData])

  /**
   * Filters servers based on search term.
   */
  const filteredServers = useMemo(() => {
    return (servers || []).filter((server) =>
      server.name?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [servers, searchTerm])

  const handleNameChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, name: value }))
  }, [])

  const handleUrlScroll = useCallback((scrollLeft: number) => {
    setUrlScrollLeft(scrollLeft)
  }, [])

  const handleHeaderScroll = useCallback((key: string, scrollLeft: number) => {
    setHeaderScrollLeft((prev) => ({ ...prev, [key]: scrollLeft }))
  }, [])

  const handleAddHeader = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      headers: [...(prev.headers || []), { key: '', value: '' }],
    }))
  }, [])

  const handleRemoveHeader = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      headers: (prev.headers || []).filter((_, i) => i !== index),
    }))
  }, [])

  const handleCancelForm = useCallback(() => {
    setShowAddForm(false)
  }, [])

  const error = toolsError || serversError
  const hasServers = servers && servers.length > 0
  const showEmptyState = !hasServers && !showAddForm
  const showNoResults = searchTerm.trim() && filteredServers.length === 0 && servers.length > 0

  // Form validation state
  const isFormValid = formData.name.trim() && formData.url?.trim()
  const isSubmitDisabled = serversLoading || isAddingServer || !isFormValid
  const testButtonLabel = getTestButtonLabel(testResult, isTestingConnection)

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
              placeholder='Search MCPs...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            variant='primary'
            disabled={serversLoading}
            className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
          >
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        {showAddForm && !serversLoading && (
          <div className='rounded-[8px] border bg-[var(--surface-3)] p-[10px]'>
            <div className='flex flex-col gap-[8px]'>
              <FormField label='Server Name'>
                <EmcnInput
                  placeholder='e.g., My MCP Server'
                  value={formData.name}
                  onChange={(e) => {
                    if (testResult) clearTestResult()
                    handleNameChange(e.target.value)
                  }}
                  className='h-9'
                />
              </FormField>

              <FormField label='Server URL'>
                <FormattedInput
                  ref={urlInputRef}
                  placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
                  value={formData.url || ''}
                  scrollLeft={urlScrollLeft}
                  showEnvVars={showEnvVars && activeInputField === 'url'}
                  envVarProps={{
                    searchTerm: envSearchTerm,
                    cursorPosition,
                    workspaceId,
                    onSelect: handleEnvVarSelect,
                    onClose: resetEnvVarState,
                  }}
                  onChange={(e) => handleInputChange('url', e.target.value)}
                  onScroll={(scrollLeft) => handleUrlScroll(scrollLeft)}
                />
              </FormField>

              <div className='flex flex-col gap-[8px]'>
                <div className='flex items-center justify-between'>
                  <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    Headers
                  </span>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={handleAddHeader}
                    className='h-6 w-6 p-0'
                  >
                    <Plus className='h-3 w-3' />
                  </Button>
                </div>

                <div className='flex max-h-[140px] flex-col gap-[8px] overflow-y-auto'>
                  {(formData.headers || []).map((header, index) => (
                    <HeaderRow
                      key={index}
                      header={header}
                      index={index}
                      headerScrollLeft={headerScrollLeft}
                      showEnvVars={showEnvVars}
                      activeInputField={activeInputField}
                      activeHeaderIndex={activeHeaderIndex}
                      envSearchTerm={envSearchTerm}
                      cursorPosition={cursorPosition}
                      workspaceId={workspaceId}
                      onInputChange={handleInputChange}
                      onHeaderScroll={handleHeaderScroll}
                      onEnvVarSelect={handleEnvVarSelect}
                      onEnvVarClose={resetEnvVarState}
                      onRemove={() => handleRemoveHeader(index)}
                    />
                  ))}
                </div>
              </div>

              <div className='flex items-center justify-between pt-[12px]'>
                <Button
                  variant='default'
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !isFormValid}
                >
                  {testButtonLabel}
                </Button>

                <div className='flex items-center gap-[8px]'>
                  <Button variant='ghost' onClick={handleCancelForm}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddServer}
                    disabled={isSubmitDisabled}
                    className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
                  >
                    {isSubmitDisabled && isFormValid ? 'Adding...' : 'Add Server'}
                  </Button>
                </div>
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
          ) : serversLoading ? (
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
                if (!server?.id) return null
                const tools = toolsByServer[server.id] || []

                return (
                  <ServerListItem
                    key={server.id}
                    server={server}
                    tools={tools}
                    isDeleting={deletingServers.has(server.id)}
                    onRemove={() => handleRemoveServer(server.id, server.name || 'this server')}
                  />
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

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
            <Button variant='default' onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={confirmDeleteServer}
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
