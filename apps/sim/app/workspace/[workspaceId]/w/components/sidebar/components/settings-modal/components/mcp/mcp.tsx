'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ChevronDown, Plus, Search, X } from 'lucide-react'
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
  Tooltip,
} from '@/components/emcn'
import { Input } from '@/components/ui'
import { cn } from '@/lib/core/utils/cn'
import {
  getIssueBadgeLabel,
  getIssueBadgeVariant,
  getMcpToolIssue,
  type McpToolIssue,
} from '@/lib/mcp/tool-validation'
import type { McpTransport } from '@/lib/mcp/types'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { useMcpServerTest } from '@/hooks/mcp/use-mcp-server-test'
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useForceRefreshMcpTools,
  useMcpServers,
  useMcpToolsQuery,
  useRefreshMcpServer,
  useStoredMcpTools,
  useUpdateMcpServer,
} from '@/hooks/queries/mcp'
import { useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { FormField, McpServerSkeleton } from './components'

/**
 * Represents a single header entry in the form.
 * Using an array of objects allows duplicate keys during editing.
 */
interface HeaderEntry {
  key: string
  value: string
}

interface McpServerFormData {
  name: string
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: HeaderEntry[]
}

interface McpServerTestResult {
  success: boolean
  message?: string
  error?: string
  warnings?: string[]
}

type InputFieldType = 'url' | 'header-key' | 'header-value'

interface EnvVarDropdownConfig {
  searchTerm: string
  cursorPosition: number
  workspaceId: string
  onSelect: (value: string) => void
  onClose: () => void
}

interface McpToolSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
}

interface McpTool {
  name: string
  description?: string
  serverId: string
  inputSchema?: McpToolSchema
}

interface McpServer {
  id: string
  name?: string
  transport?: string
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string | null
  lastConnected?: string
}

const logger = createLogger('McpSettings')

/**
 * Checks if a URL's hostname is in the allowed domains list.
 * Returns true if no allowlist is configured (null) or the domain matches.
 */
function isDomainAllowed(url: string | undefined, allowedDomains: string[] | null): boolean {
  if (allowedDomains === null) return true
  if (!url) return true
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return allowedDomains.includes(hostname)
  } catch {
    return false
  }
}

const DEFAULT_FORM_DATA: McpServerFormData = {
  name: '',
  transport: 'streamable-http',
  url: '',
  timeout: 30000,
  headers: [{ key: '', value: '' }],
}

/**
 * Formats a transport type string for display.
 */
function formatTransportLabel(transport: string): string {
  return transport
    .split('-')
    .map((word) =>
      ['http', 'sse', 'stdio'].includes(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('-')
}

/**
 * Formats a tools list for display in the server list.
 */
function formatToolsLabel(tools: McpTool[], connectionStatus?: string): string {
  if (connectionStatus === 'error') {
    return 'Unable to connect'
  }
  const count = tools.length
  const plural = count !== 1 ? 's' : ''
  const names = count > 0 ? `: ${tools.map((t) => t.name).join(', ')}` : ''
  return `${count} tool${plural}${names}`
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

interface FormattedInputProps {
  ref?: React.RefObject<HTMLInputElement | null>
  placeholder: string
  value: string
  scrollLeft: number
  showEnvVars: boolean
  envVarProps: EnvVarDropdownConfig
  availableEnvVars?: Set<string>
  className?: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onScroll: (scrollLeft: number) => void
}

function FormattedInput({
  ref,
  placeholder,
  value,
  scrollLeft,
  showEnvVars,
  envVarProps,
  availableEnvVars,
  className,
  onChange,
  onScroll,
}: FormattedInputProps) {
  const handleScroll = (e: { currentTarget: HTMLInputElement }) => {
    onScroll(e.currentTarget.scrollLeft)
  }

  return (
    <div className={cn('relative', className)}>
      <EmcnInput
        ref={ref}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onScroll={handleScroll}
        onInput={handleScroll}
        className='h-9 text-transparent caret-foreground placeholder:text-[var(--text-muted)]'
      />
      <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-[8px] py-[6px] font-medium font-sans text-sm'>
        <div className='whitespace-nowrap' style={{ transform: `translateX(-${scrollLeft}px)` }}>
          {formatDisplayText(value, { availableEnvVars })}
        </div>
      </div>
      {showEnvVars && (
        <EnvVarDropdown
          visible={showEnvVars}
          onSelect={envVarProps.onSelect}
          searchTerm={envVarProps.searchTerm}
          inputValue={value}
          cursorPosition={envVarProps.cursorPosition}
          workspaceId={envVarProps.workspaceId}
          onClose={envVarProps.onClose}
          className='w-full'
          maxHeight='200px'
          style={{ position: 'absolute', top: '100%', left: 0, zIndex: 99999 }}
        />
      )}
    </div>
  )
}

interface HeaderRowProps {
  header: HeaderEntry
  index: number
  headerScrollLeft: Record<string, number>
  showEnvVars: boolean
  activeInputField: InputFieldType | null
  activeHeaderIndex: number | null
  envSearchTerm: string
  cursorPosition: number
  workspaceId: string
  availableEnvVars?: Set<string>
  onInputChange: (field: InputFieldType, value: string, index?: number) => void
  onHeaderScroll: (key: string, scrollLeft: number) => void
  onEnvVarSelect: (value: string) => void
  onEnvVarClose: () => void
  onRemove: () => void
}

function HeaderRow({
  header,
  index,
  headerScrollLeft,
  showEnvVars,
  activeInputField,
  activeHeaderIndex,
  envSearchTerm,
  cursorPosition,
  workspaceId,
  availableEnvVars,
  onInputChange,
  onHeaderScroll,
  onEnvVarSelect,
  onEnvVarClose,
  onRemove,
}: HeaderRowProps) {
  const isKeyActive =
    showEnvVars && activeInputField === 'header-key' && activeHeaderIndex === index
  const isValueActive =
    showEnvVars && activeInputField === 'header-value' && activeHeaderIndex === index

  const envVarProps: EnvVarDropdownConfig = {
    searchTerm: envSearchTerm,
    cursorPosition,
    workspaceId,
    onSelect: onEnvVarSelect,
    onClose: onEnvVarClose,
  }

  return (
    <div className='relative flex items-center gap-[8px]'>
      <FormattedInput
        placeholder='Name'
        value={header.key || ''}
        scrollLeft={headerScrollLeft[`key-${index}`] || 0}
        showEnvVars={isKeyActive}
        envVarProps={envVarProps}
        availableEnvVars={availableEnvVars}
        className='flex-1'
        onChange={(e) => onInputChange('header-key', e.target.value, index)}
        onScroll={(scrollLeft) => onHeaderScroll(`key-${index}`, scrollLeft)}
      />

      <FormattedInput
        placeholder='Value'
        value={header.value || ''}
        scrollLeft={headerScrollLeft[`value-${index}`] || 0}
        showEnvVars={isValueActive}
        envVarProps={envVarProps}
        availableEnvVars={availableEnvVars}
        className='flex-1'
        onChange={(e) => onInputChange('header-value', e.target.value, index)}
        onScroll={(scrollLeft) => onHeaderScroll(`value-${index}`, scrollLeft)}
      />

      <Button type='button' variant='ghost' onClick={onRemove} className='h-6 w-6 shrink-0 p-0'>
        <X className='h-3 w-3' />
      </Button>
    </div>
  )
}

interface ServerListItemProps {
  server: McpServer
  tools: McpTool[]
  isDeleting: boolean
  isLoadingTools?: boolean
  isRefreshing?: boolean
  onRemove: () => void
  onViewDetails: () => void
}

function ServerListItem({
  server,
  tools,
  isDeleting,
  isLoadingTools = false,
  isRefreshing = false,
  onRemove,
  onViewDetails,
}: ServerListItemProps) {
  const transportLabel = formatTransportLabel(server.transport || 'http')
  const toolsLabel = formatToolsLabel(tools, server.connectionStatus)
  const isError = server.connectionStatus === 'error'

  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          <span className='max-w-[200px] truncate font-medium text-[14px]'>
            {server.name || 'Unnamed Server'}
          </span>
          <span className='text-[13px] text-[var(--text-secondary)]'>({transportLabel})</span>
        </div>
        <p
          className={`truncate text-[13px] ${isError ? 'text-red-500 dark:text-red-400' : 'text-[var(--text-muted)]'}`}
        >
          {isRefreshing
            ? 'Refreshing...'
            : isLoadingTools && tools.length === 0
              ? 'Loading...'
              : toolsLabel}
        </p>
      </div>
      <div className='flex flex-shrink-0 items-center gap-[4px]'>
        <Button variant='default' onClick={onViewDetails}>
          Details
        </Button>
        <Button variant='ghost' onClick={onRemove} disabled={isDeleting}>
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}

interface MCPProps {
  initialServerId?: string | null
}

/**
 * MCP Settings component for managing Model Context Protocol servers.
 * Handles server CRUD operations, connection testing, and environment variable integration.
 */
export function MCP({ initialServerId }: MCPProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    data: servers = [],
    isLoading: serversLoading,
    error: serversError,
  } = useMcpServers(workspaceId)
  const {
    data: mcpToolsData = [],
    error: toolsError,
    isLoading: toolsLoading,
    isFetching: toolsFetching,
  } = useMcpToolsQuery(workspaceId)
  const { data: storedTools = [], refetch: refetchStoredTools } = useStoredMcpTools(workspaceId)
  const forceRefreshTools = useForceRefreshMcpTools()
  const createServerMutation = useCreateMcpServer()
  const deleteServerMutation = useDeleteMcpServer()
  const refreshServerMutation = useRefreshMcpServer()
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()
  const updateServerMutation = useUpdateMcpServer()
  const {
    testResult: editTestResult,
    isTestingConnection: isEditTestingConnection,
    testConnection: editTestConnection,
    clearTestResult: clearEditTestResult,
  } = useMcpServerTest()
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId)

  const [allowedMcpDomains, setAllowedMcpDomains] = useState<string[] | null>(null)

  useEffect(() => {
    fetch('/api/settings/allowed-mcp-domains')
      .then((res) => res.json())
      .then((data) => setAllowedMcpDomains(data.allowedMcpDomains ?? null))
      .catch(() => setAllowedMcpDomains(null))
  }, [])

  const urlInputRef = useRef<HTMLInputElement>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)
  const [isAddingServer, setIsAddingServer] = useState(false)

  const [searchTerm, setSearchTerm] = useState('')
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<{ id: string; name: string } | null>(null)

  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [refreshingServers, setRefreshingServers] = useState<
    Record<string, { status: 'refreshing' | 'refreshed'; workflowsUpdated?: number }>
  >({})
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envSearchTerm, setEnvSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<InputFieldType | null>(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)

  const [urlScrollLeft, setUrlScrollLeft] = useState(0)
  const [headerScrollLeft, setHeaderScrollLeft] = useState<Record<string, number>>({})

  const [showEditModal, setShowEditModal] = useState(false)
  const [editFormData, setEditFormData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)
  const [editOriginalData, setEditOriginalData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)
  const [isUpdatingServer, setIsUpdatingServer] = useState(false)
  const [editSaveError, setEditSaveError] = useState<string | null>(null)
  const [editShowEnvVars, setEditShowEnvVars] = useState(false)
  const [editEnvSearchTerm, setEditEnvSearchTerm] = useState('')
  const [editCursorPosition, setEditCursorPosition] = useState(0)
  const [editActiveInputField, setEditActiveInputField] = useState<InputFieldType | null>(null)
  const [editActiveHeaderIndex, setEditActiveHeaderIndex] = useState<number | null>(null)
  const [editUrlScrollLeft, setEditUrlScrollLeft] = useState(0)
  const [editHeaderScrollLeft, setEditHeaderScrollLeft] = useState<Record<string, number>>({})

  useEffect(() => {
    if (initialServerId && servers.some((s) => s.id === initialServerId)) {
      setSelectedServerId(initialServerId)
    }
  }, [initialServerId, servers])

  useEffect(() => {
    if (selectedServerId) {
      forceRefreshTools(workspaceId)
      refetchStoredTools()
    }
  }, [selectedServerId, workspaceId, forceRefreshTools, refetchStoredTools])

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
   * Only creates the server if connection test succeeds.
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

      const connectionResult = await testConnection(serverConfig)

      if (!connectionResult.success) {
        logger.error('Connection test failed, server not added:', connectionResult.error)
        return
      }

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
  }, [formData, testConnection, createServerMutation, workspaceId, headersToRecord, resetForm])

  /**
   * Opens the delete confirmation dialog for an MCP server.
   */
  const handleRemoveServer = useCallback((serverId: string, serverName: string) => {
    setServerToDelete({ id: serverId, name: serverName })
    setShowDeleteDialog(true)
  }, [])

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

  /**
   * Opens the detail view for a specific server.
   * Note: Tool refresh is handled by the useEffect that watches selectedServerId
   */
  const handleViewDetails = useCallback((serverId: string) => {
    setSelectedServerId(serverId)
  }, [])

  /**
   * Closes the detail view and returns to the server list.
   */
  const handleBackToList = useCallback(() => {
    setSelectedServerId(null)
    setExpandedTools(new Set())
  }, [])

  /**
   * Toggles the expanded state of a tool's parameters.
   */
  const toggleToolExpanded = useCallback((toolName: string) => {
    setExpandedTools((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(toolName)) {
        newSet.delete(toolName)
      } else {
        newSet.add(toolName)
      }
      return newSet
    })
  }, [])

  /**
   * Refreshes a server's tools by re-discovering them from the MCP server.
   * Also syncs updated tool schemas to all workflows using those tools.
   * If the active workflow was updated, reloads its subblock values.
   */
  const handleRefreshServer = useCallback(
    async (serverId: string) => {
      try {
        setRefreshingServers((prev) => ({ ...prev, [serverId]: { status: 'refreshing' } }))
        const result = await refreshServerMutation.mutateAsync({ workspaceId, serverId })
        logger.info(
          `Refreshed MCP server: ${serverId}, workflows updated: ${result.workflowsUpdated}`
        )

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (activeWorkflowId && result.updatedWorkflowIds?.includes(activeWorkflowId)) {
          logger.info(`Active workflow ${activeWorkflowId} was updated, reloading subblock values`)
          try {
            const response = await fetch(`/api/workflows/${activeWorkflowId}`)
            if (response.ok) {
              const { data: workflowData } = await response.json()
              if (workflowData?.state?.blocks) {
                useSubBlockStore
                  .getState()
                  .initializeFromWorkflow(activeWorkflowId, workflowData.state.blocks)
              }
            }
          } catch (reloadError) {
            logger.warn('Failed to reload workflow subblock values:', reloadError)
          }
        }

        setRefreshingServers((prev) => ({
          ...prev,
          [serverId]: { status: 'refreshed', workflowsUpdated: result.workflowsUpdated },
        }))
        setTimeout(() => {
          setRefreshingServers((prev) => {
            const newState = { ...prev }
            delete newState[serverId]
            return newState
          })
        }, 3000)
      } catch (error) {
        logger.error('Failed to refresh MCP server:', error)
        setRefreshingServers((prev) => {
          const newState = { ...prev }
          delete newState[serverId]
          return newState
        })
      }
    },
    [refreshServerMutation, workspaceId]
  )

  /**
   * Resets edit modal environment variable dropdown state.
   */
  const resetEditEnvVarState = useCallback(() => {
    setEditShowEnvVars(false)
    setEditActiveInputField(null)
    setEditActiveHeaderIndex(null)
  }, [])

  /**
   * Opens the edit modal and populates form with current server data.
   */
  const handleOpenEditModal = useCallback(
    (server: McpServer) => {
      const headers: HeaderEntry[] = server.headers
        ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
        : [{ key: '', value: '' }]
      if (headers.length === 0) headers.push({ key: '', value: '' })

      const data: McpServerFormData = {
        name: server.name || '',
        transport: (server.transport as McpTransport) || 'streamable-http',
        url: server.url || '',
        timeout: 30000,
        headers,
      }
      setEditFormData(data)
      setEditOriginalData(JSON.parse(JSON.stringify(data)))
      setShowEditModal(true)
      setEditSaveError(null)
      clearEditTestResult()
      resetEditEnvVarState()
      setEditUrlScrollLeft(0)
      setEditHeaderScrollLeft({})
    },
    [clearEditTestResult, resetEditEnvVarState]
  )

  /**
   * Closes the edit modal and resets state.
   */
  const handleCloseEditModal = useCallback(() => {
    setShowEditModal(false)
    setEditFormData(DEFAULT_FORM_DATA)
    setEditOriginalData(DEFAULT_FORM_DATA)
    setEditSaveError(null)
    clearEditTestResult()
    resetEditEnvVarState()
  }, [clearEditTestResult, resetEditEnvVarState])

  /**
   * Handles environment variable selection in the edit modal.
   */
  const handleEditEnvVarSelect = useCallback(
    (newValue: string) => {
      if (editActiveInputField === 'url') {
        setEditFormData((prev) => ({ ...prev, url: newValue }))
      } else if (editActiveHeaderIndex !== null) {
        const field = editActiveInputField === 'header-key' ? 'key' : 'value'
        const processedValue = field === 'key' ? newValue.replace(/[{}]/g, '') : newValue
        setEditFormData((prev) => {
          const newHeaders = [...(prev.headers || [])]
          if (newHeaders[editActiveHeaderIndex]) {
            newHeaders[editActiveHeaderIndex] = {
              ...newHeaders[editActiveHeaderIndex],
              [field]: processedValue,
            }
          }
          return { ...prev, headers: newHeaders }
        })
      }
      resetEditEnvVarState()
    },
    [editActiveInputField, editActiveHeaderIndex, resetEditEnvVarState]
  )

  /**
   * Handles input changes in the edit modal and manages env var dropdown.
   */
  const handleEditInputChange = useCallback(
    (field: InputFieldType, value: string, headerIndex?: number) => {
      const input = document.activeElement as HTMLInputElement
      const pos = input?.selectionStart || 0
      setEditCursorPosition(pos)

      if (editTestResult) {
        clearEditTestResult()
      }

      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setEditShowEnvVars(envVarTrigger.show)
      setEditEnvSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      if (envVarTrigger.show) {
        setEditActiveInputField(field)
        setEditActiveHeaderIndex(headerIndex ?? null)
      } else {
        resetEditEnvVarState()
      }

      if (field === 'url') {
        setEditFormData((prev) => ({ ...prev, url: value }))
      } else if (headerIndex !== undefined) {
        const headerField = field === 'header-key' ? 'key' : 'value'
        setEditFormData((prev) => {
          const newHeaders = [...(prev.headers || [])]
          if (newHeaders[headerIndex]) {
            newHeaders[headerIndex] = { ...newHeaders[headerIndex], [headerField]: value }
          }
          return { ...prev, headers: newHeaders }
        })
      }
    },
    [editTestResult, clearEditTestResult, resetEditEnvVarState]
  )

  const handleEditHeaderScroll = useCallback((key: string, scrollLeft: number) => {
    setEditHeaderScrollLeft((prev) => ({ ...prev, [key]: scrollLeft }))
  }, [])

  const handleEditAddHeader = useCallback(() => {
    setEditFormData((prev) => ({
      ...prev,
      headers: [...(prev.headers || []), { key: '', value: '' }],
    }))
  }, [])

  const handleEditRemoveHeader = useCallback((index: number) => {
    setEditFormData((prev) => ({
      ...prev,
      headers: (prev.headers || []).filter((_, i) => i !== index),
    }))
  }, [])

  /**
   * Tests the connection with the edit modal's form data.
   */
  const handleEditTestConnection = useCallback(async () => {
    if (!editFormData.name.trim() || !editFormData.url?.trim()) return

    await editTestConnection({
      name: editFormData.name,
      transport: editFormData.transport,
      url: editFormData.url,
      headers: headersToRecord(editFormData.headers),
      timeout: editFormData.timeout,
      workspaceId,
    })
  }, [editFormData, editTestConnection, workspaceId, headersToRecord])

  /**
   * Saves the edited MCP server after validating and testing the connection.
   */
  const handleSaveEdit = useCallback(async () => {
    if (!selectedServerId || !editFormData.name.trim()) return

    setEditSaveError(null)
    try {
      const headersRecord = headersToRecord(editFormData.headers)
      const serverConfig = {
        name: editFormData.name,
        transport: editFormData.transport,
        url: editFormData.url,
        headers: headersRecord,
        timeout: editFormData.timeout,
        workspaceId,
      }

      const connectionResult = await editTestConnection(serverConfig)

      if (!connectionResult.success) {
        setEditSaveError(connectionResult.error || 'Connection test failed')
        return
      }

      setIsUpdatingServer(true)
      const currentServer = servers.find((s) => s.id === selectedServerId)
      await updateServerMutation.mutateAsync({
        workspaceId,
        serverId: selectedServerId,
        updates: {
          name: editFormData.name.trim(),
          transport: editFormData.transport,
          url: editFormData.url,
          headers: headersRecord,
          timeout: editFormData.timeout || 30000,
          enabled: currentServer?.enabled ?? true,
        },
      })

      setShowEditModal(false)
      logger.info(`Updated MCP server: ${editFormData.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update server'
      setEditSaveError(message)
      logger.error('Failed to update MCP server:', error)
    } finally {
      setIsUpdatingServer(false)
    }
  }, [
    selectedServerId,
    editFormData,
    editTestConnection,
    updateServerMutation,
    workspaceId,
    headersToRecord,
    servers,
  ])

  /**
   * Gets the selected server and its tools for the detail view.
   */
  const selectedServer = useMemo(() => {
    if (!selectedServerId) return null
    const server = servers.find((s) => s.id === selectedServerId) as McpServer | undefined
    if (!server) return null
    const serverTools = (toolsByServer[selectedServerId] || []) as McpTool[]
    return { server, tools: serverTools }
  }, [selectedServerId, servers, toolsByServer])

  const error = toolsError || serversError
  const hasServers = servers && servers.length > 0
  const shouldShowForm = showAddForm || !hasServers
  const showNoResults = searchTerm.trim() && filteredServers.length === 0 && servers.length > 0

  const isFormValid = formData.name.trim() && formData.url?.trim()
  const isAddDomainBlocked = !isDomainAllowed(formData.url, allowedMcpDomains)
  const isSubmitDisabled = serversLoading || isAddingServer || !isFormValid || isAddDomainBlocked
  const testButtonLabel = getTestButtonLabel(testResult, isTestingConnection)

  const isEditFormValid = editFormData.name.trim() && editFormData.url?.trim()
  const isEditDomainBlocked = !isDomainAllowed(editFormData.url, allowedMcpDomains)
  const editTestButtonLabel = getTestButtonLabel(editTestResult, isEditTestingConnection)
  const hasEditChanges = useMemo(() => {
    if (editFormData.name !== editOriginalData.name) return true
    if (editFormData.url !== editOriginalData.url) return true
    if (editFormData.transport !== editOriginalData.transport) return true

    const currentHeaders = editFormData.headers || []
    const originalHeaders = editOriginalData.headers || []
    if (currentHeaders.length !== originalHeaders.length) return true
    for (let i = 0; i < currentHeaders.length; i++) {
      if (
        currentHeaders[i].key !== originalHeaders[i].key ||
        currentHeaders[i].value !== originalHeaders[i].value
      )
        return true
    }
    return false
  }, [editFormData, editOriginalData])

  /**
   * Gets issues for stored tools that reference a specific server tool.
   * Returns issues from all workflows that have stored this tool.
   */
  const getStoredToolIssues = useCallback(
    (serverId: string, toolName: string): { issue: McpToolIssue; workflowName: string }[] => {
      const relevantStoredTools = storedTools.filter(
        (st) => st.serverId === serverId && st.toolName === toolName
      )

      const serverStates = servers.map((s) => ({
        id: s.id,
        url: s.url,
        connectionStatus: s.connectionStatus,
        lastError: s.lastError || undefined,
      }))

      const discoveredTools = mcpToolsData.map((t) => ({
        serverId: t.serverId,
        name: t.name,
        inputSchema: t.inputSchema,
      }))

      const issues: { issue: McpToolIssue; workflowName: string }[] = []

      for (const storedTool of relevantStoredTools) {
        const issue = getMcpToolIssue(
          {
            serverId: storedTool.serverId,
            serverUrl: storedTool.serverUrl,
            toolName: storedTool.toolName,
            schema: storedTool.schema,
          },
          serverStates,
          discoveredTools
        )

        if (issue) {
          issues.push({ issue, workflowName: storedTool.workflowName })
        }
      }

      return issues
    },
    [storedTools, servers, mcpToolsData]
  )

  if (selectedServer) {
    const { server, tools } = selectedServer
    const transportLabel = formatTransportLabel(server.transport || 'http')

    return (
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-[16px]'>
            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                Server Name
              </span>
              <p className='text-[14px] text-[var(--text-secondary)]'>
                {server.name || 'Unnamed Server'}
              </p>
            </div>

            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>Transport</span>
              <p className='text-[14px] text-[var(--text-secondary)]'>{transportLabel}</p>
            </div>

            {server.url && (
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>URL</span>
                <p className='break-all text-[14px] text-[var(--text-secondary)]'>{server.url}</p>
              </div>
            )}

            {server.connectionStatus === 'error' && (
              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>Status</span>
                <p className='text-[14px] text-red-500 dark:text-red-400'>
                  {server.lastError || 'Unable to connect'}
                </p>
              </div>
            )}

            <div className='flex flex-col gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                Tools ({tools.length})
              </span>
              {tools.length === 0 ? (
                <p className='text-[13px] text-[var(--text-muted)]'>No tools available</p>
              ) : (
                <div className='flex flex-col gap-[8px]'>
                  {tools.map((tool) => {
                    const issues = getStoredToolIssues(server.id, tool.name)
                    const affectedWorkflows = issues.map((i) => i.workflowName)
                    const isExpanded = expandedTools.has(tool.name)
                    const hasParams =
                      tool.inputSchema?.properties &&
                      Object.keys(tool.inputSchema.properties).length > 0
                    const requiredParams = tool.inputSchema?.required || []

                    return (
                      <div
                        key={tool.name}
                        className='overflow-hidden rounded-[6px] border bg-[var(--surface-3)]'
                      >
                        <button
                          type='button'
                          onClick={() => hasParams && toggleToolExpanded(tool.name)}
                          className={cn(
                            'flex w-full items-start justify-between px-[10px] py-[8px] text-left',
                            hasParams && 'cursor-pointer hover:bg-[var(--surface-4)]'
                          )}
                          disabled={!hasParams}
                        >
                          <div className='flex-1'>
                            <div className='flex h-[16px] items-center gap-[6px]'>
                              <p className='font-medium text-[13px] text-[var(--text-primary)] leading-none'>
                                {tool.name}
                              </p>
                              {issues.length > 0 && (
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <div className='flex items-center'>
                                      <Badge
                                        variant={getIssueBadgeVariant(issues[0].issue)}
                                        size='sm'
                                      >
                                        {getIssueBadgeLabel(issues[0].issue)}
                                      </Badge>
                                    </div>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content>
                                    Update in: {affectedWorkflows.join(', ')}
                                  </Tooltip.Content>
                                </Tooltip.Root>
                              )}
                            </div>
                            {tool.description && (
                              <p className='mt-[4px] text-[13px] text-[var(--text-tertiary)]'>
                                {tool.description}
                              </p>
                            )}
                          </div>
                          {hasParams && (
                            <ChevronDown
                              className={cn(
                                'mt-[2px] h-[14px] w-[14px] flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                                isExpanded && 'rotate-180'
                              )}
                            />
                          )}
                        </button>

                        {isExpanded && hasParams && (
                          <div className='border-[var(--border-1)] border-t bg-[var(--surface-2)] px-[10px] py-[8px]'>
                            <p className='mb-[6px] font-medium text-[11px] text-[var(--text-muted)] uppercase tracking-wide'>
                              Parameters
                            </p>
                            <div className='flex flex-col gap-[6px]'>
                              {Object.entries(tool.inputSchema!.properties!).map(
                                ([paramName, param]) => {
                                  const isRequired = requiredParams.includes(paramName)
                                  const paramType =
                                    typeof param === 'object' && param !== null
                                      ? (param as { type?: string }).type || 'any'
                                      : 'any'
                                  const paramDesc =
                                    typeof param === 'object' && param !== null
                                      ? (param as { description?: string }).description
                                      : undefined

                                  return (
                                    <div
                                      key={paramName}
                                      className='rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-3)] px-[8px] py-[6px]'
                                    >
                                      <div className='flex items-center gap-[6px]'>
                                        <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                                          {paramName}
                                        </span>
                                        <Badge variant='outline' size='sm'>
                                          {paramType}
                                        </Badge>
                                        {isRequired && (
                                          <Badge variant='default' size='sm'>
                                            required
                                          </Badge>
                                        )}
                                      </div>
                                      {paramDesc && (
                                        <p className='mt-[3px] text-[11px] text-[var(--text-tertiary)] leading-relaxed'>
                                          {paramDesc}
                                        </p>
                                      )}
                                    </div>
                                  )
                                }
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className='mt-auto flex items-center justify-between'>
          <div className='flex items-center gap-[8px]'>
            <Button
              onClick={() => handleRefreshServer(server.id)}
              variant='default'
              disabled={!!refreshingServers[server.id]}
            >
              {refreshingServers[server.id]?.status === 'refreshing'
                ? 'Refreshing...'
                : refreshingServers[server.id]?.status === 'refreshed'
                  ? refreshingServers[server.id].workflowsUpdated
                    ? `Synced (${refreshingServers[server.id].workflowsUpdated} workflow${refreshingServers[server.id].workflowsUpdated === 1 ? '' : 's'})`
                    : 'Refreshed'
                  : 'Refresh Tools'}
            </Button>
            <Button onClick={() => handleOpenEditModal(server)} variant='default'>
              Edit
            </Button>
          </div>
          <Button onClick={handleBackToList} variant='tertiary'>
            Back
          </Button>
        </div>

        <Modal open={showEditModal} onOpenChange={setShowEditModal}>
          <ModalContent>
            <ModalHeader>Edit MCP Server</ModalHeader>
            <ModalBody>
              <div className='flex flex-col gap-[8px]'>
                <FormField label='Server Name'>
                  <EmcnInput
                    placeholder='e.g., My MCP Server'
                    value={editFormData.name}
                    onChange={(e) => {
                      if (editTestResult) clearEditTestResult()
                      setEditFormData((prev) => ({ ...prev, name: e.target.value }))
                    }}
                    className='h-9'
                  />
                </FormField>

                <FormField label='Server URL'>
                  <FormattedInput
                    placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
                    value={editFormData.url || ''}
                    scrollLeft={editUrlScrollLeft}
                    showEnvVars={editShowEnvVars && editActiveInputField === 'url'}
                    envVarProps={{
                      searchTerm: editEnvSearchTerm,
                      cursorPosition: editCursorPosition,
                      workspaceId,
                      onSelect: handleEditEnvVarSelect,
                      onClose: resetEditEnvVarState,
                    }}
                    availableEnvVars={availableEnvVars}
                    onChange={(e) => handleEditInputChange('url', e.target.value)}
                    onScroll={setEditUrlScrollLeft}
                  />
                  {isEditDomainBlocked && (
                    <p className='mt-[4px] text-[12px] text-[var(--text-error)]'>
                      Domain not permitted by server policy
                    </p>
                  )}
                </FormField>

                <div className='flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Headers
                    </span>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={handleEditAddHeader}
                      className='h-6 w-6 p-0'
                    >
                      <Plus className='h-3 w-3' />
                    </Button>
                  </div>

                  <div className='flex max-h-[140px] flex-col gap-[8px] overflow-y-auto'>
                    {(editFormData.headers || []).map((header, index) => (
                      <HeaderRow
                        key={index}
                        header={header}
                        index={index}
                        headerScrollLeft={editHeaderScrollLeft}
                        showEnvVars={editShowEnvVars}
                        activeInputField={editActiveInputField}
                        activeHeaderIndex={editActiveHeaderIndex}
                        envSearchTerm={editEnvSearchTerm}
                        cursorPosition={editCursorPosition}
                        workspaceId={workspaceId}
                        availableEnvVars={availableEnvVars}
                        onInputChange={handleEditInputChange}
                        onHeaderScroll={handleEditHeaderScroll}
                        onEnvVarSelect={handleEditEnvVarSelect}
                        onEnvVarClose={resetEditEnvVarState}
                        onRemove={() => handleEditRemoveHeader(index)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              {editSaveError && (
                <p className='mb-[8px] w-full text-[12px] text-[var(--text-error)]'>
                  {editSaveError}
                </p>
              )}
              <div className='flex w-full items-center justify-between'>
                <Button
                  variant='default'
                  onClick={handleEditTestConnection}
                  disabled={isEditTestingConnection || !isEditFormValid || isEditDomainBlocked}
                >
                  {editTestButtonLabel}
                </Button>
                <div className='flex items-center gap-[8px]'>
                  <Button variant='ghost' onClick={handleCloseEditModal}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={
                      !hasEditChanges || isUpdatingServer || !isEditFormValid || isEditDomainBlocked
                    }
                    variant='tertiary'
                  >
                    {isUpdatingServer ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
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
              placeholder='Search MCPs...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            variant='tertiary'
            disabled={serversLoading}
          >
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
        </div>

        {shouldShowForm && !serversLoading && (
          <div className='rounded-[8px] border p-[10px]'>
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
                  availableEnvVars={availableEnvVars}
                  onChange={(e) => handleInputChange('url', e.target.value)}
                  onScroll={(scrollLeft) => handleUrlScroll(scrollLeft)}
                />
                {isAddDomainBlocked && (
                  <p className='mt-[4px] text-[12px] text-[var(--text-error)]'>
                    Domain not permitted by server policy
                  </p>
                )}
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
                      availableEnvVars={availableEnvVars}
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
                  disabled={isTestingConnection || !isFormValid || isAddDomainBlocked}
                >
                  {testButtonLabel}
                </Button>

                <div className='flex items-center gap-[8px]'>
                  <Button variant='ghost' onClick={handleCancelForm}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddServer} disabled={isSubmitDisabled} variant='tertiary'>
                    {isSubmitDisabled && isFormValid && !isAddDomainBlocked
                      ? 'Adding...'
                      : 'Add Server'}
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
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredServers.map((server) => {
                if (!server?.id) return null
                const tools = toolsByServer[server.id] || []
                const isLoadingTools = toolsLoading || toolsFetching

                return (
                  <ServerListItem
                    key={server.id}
                    server={server}
                    tools={tools}
                    isDeleting={deletingServers.has(server.id)}
                    isLoadingTools={isLoadingTools}
                    isRefreshing={refreshingServers[server.id]?.status === 'refreshing'}
                    onRemove={() => handleRemoveServer(server.id, server.name || 'this server')}
                    onViewDetails={() => handleViewDetails(server.id)}
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
        <ModalContent size='sm'>
          <ModalHeader>Delete MCP Server</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{serverToDelete?.name}</span>
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmDeleteServer}>
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
