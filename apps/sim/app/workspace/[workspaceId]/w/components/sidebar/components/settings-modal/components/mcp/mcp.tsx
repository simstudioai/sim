'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Plus, Search, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { createLogger } from '@/lib/logs/console/logger'
import type { McpTransport } from '@/lib/mcp/types'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { useMcpServersStore } from '@/stores/mcp-servers/store'

const logger = createLogger('McpSettings')

interface McpServerFormData {
  name: string
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: Record<string, string>
}

export function MCP() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { mcpTools, error: toolsError, refreshTools } = useMcpTools(workspaceId)
  const {
    servers,
    isLoading: serversLoading,
    error: serversError,
    fetchServers,
    createServer,
    deleteServer,
  } = useMcpServersStore()

  const [showAddForm, setShowAddForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [deletingServers, setDeletingServers] = useState<Set<string>>(new Set())
  const [formData, setFormData] = useState<McpServerFormData>({
    name: '',
    transport: 'streamable-http',
    url: '',
    timeout: 30000,
    headers: {}, // Start with no headers
  })

  // Environment variable dropdown state
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envSearchTerm, setEnvSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<
    'url' | 'header-key' | 'header-value' | null
  >(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  // MCP server testing
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  // Loading state for adding server
  const [isAddingServer, setIsAddingServer] = useState(false)

  // State for tracking input scroll position
  const [urlScrollLeft, setUrlScrollLeft] = useState(0)
  const [headerScrollLeft, setHeaderScrollLeft] = useState<Record<string, number>>({})

  // Handle environment variable selection
  const handleEnvVarSelect = useCallback(
    (newValue: string) => {
      if (activeInputField === 'url') {
        setFormData((prev) => ({ ...prev, url: newValue }))
      } else if (activeInputField === 'header-key' && activeHeaderIndex !== null) {
        const headerEntries = Object.entries(formData.headers || {})
        const [oldKey, value] = headerEntries[activeHeaderIndex]
        const newHeaders = { ...formData.headers }
        delete newHeaders[oldKey]
        newHeaders[newValue.replace(/[{}]/g, '')] = value
        setFormData((prev) => ({ ...prev, headers: newHeaders }))
      } else if (activeInputField === 'header-value' && activeHeaderIndex !== null) {
        const headerEntries = Object.entries(formData.headers || {})
        const [key] = headerEntries[activeHeaderIndex]
        setFormData((prev) => ({
          ...prev,
          headers: { ...prev.headers, [key]: newValue },
        }))
      }
      setShowEnvVars(false)
      setActiveInputField(null)
      setActiveHeaderIndex(null)
    },
    [activeInputField, activeHeaderIndex, formData.headers]
  )

  // Handle input change with env var detection
  const handleInputChange = useCallback(
    (field: 'url' | 'header-key' | 'header-value', value: string, headerIndex?: number) => {
      const input = document.activeElement as HTMLInputElement
      const pos = input?.selectionStart || 0

      setCursorPosition(pos)

      // Clear test result when any field changes
      if (testResult) {
        clearTestResult()
      }

      // Check if we should show the environment variables dropdown
      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setShowEnvVars(envVarTrigger.show)
      setEnvSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      if (envVarTrigger.show) {
        setActiveInputField(field)
        setActiveHeaderIndex(headerIndex ?? null)
      } else {
        setActiveInputField(null)
        setActiveHeaderIndex(null)
      }

      // Update form data
      if (field === 'url') {
        setFormData((prev) => ({ ...prev, url: value }))
      } else if (field === 'header-key' && headerIndex !== undefined) {
        const headerEntries = Object.entries(formData.headers || {})
        const [oldKey, headerValue] = headerEntries[headerIndex]
        const newHeaders = { ...formData.headers }
        delete newHeaders[oldKey]
        newHeaders[value] = headerValue
        setFormData((prev) => ({ ...prev, headers: newHeaders }))
      } else if (field === 'header-value' && headerIndex !== undefined) {
        const headerEntries = Object.entries(formData.headers || {})
        const [key] = headerEntries[headerIndex]
        setFormData((prev) => ({
          ...prev,
          headers: { ...prev.headers, [key]: value },
        }))
      }
    },
    [formData.headers]
  )

  const handleTestConnection = useCallback(async () => {
    if (!formData.name.trim() || !formData.url?.trim()) return

    await testConnection({
      name: formData.name,
      transport: formData.transport,
      url: formData.url,
      headers: formData.headers,
      timeout: formData.timeout,
      workspaceId,
    })
  }, [formData, testConnection, workspaceId])

  const handleAddServer = useCallback(async () => {
    if (!formData.name.trim()) return

    setIsAddingServer(true)
    try {
      // If no test has been done, test first
      if (!testResult) {
        const result = await testConnection({
          name: formData.name,
          transport: formData.transport,
          url: formData.url,
          headers: formData.headers,
          timeout: formData.timeout,
          workspaceId,
        })

        // If test fails, don't proceed
        if (!result.success) {
          return
        }
      }

      // If we have a failed test result, don't proceed
      if (testResult && !testResult.success) {
        return
      }

      await createServer(workspaceId, {
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url,
        timeout: formData.timeout || 30000,
        headers: formData.headers,
        enabled: true,
      })

      logger.info(`Added MCP server: ${formData.name}`)

      // Reset form and hide form immediately after server creation
      setFormData({
        name: '',
        transport: 'streamable-http',
        url: '',
        timeout: 30000,
        headers: {}, // Reset with no headers
      })
      setShowAddForm(false)
      setShowEnvVars(false)
      setActiveInputField(null)
      setActiveHeaderIndex(null)
      clearTestResult()

      // Refresh tools in the background without waiting
      refreshTools(true) // Force refresh after adding server
    } catch (error) {
      logger.error('Failed to add MCP server:', error)
    } finally {
      setIsAddingServer(false)
    }
  }, [
    formData,
    testResult,
    testConnection,
    createServer,
    refreshTools,
    clearTestResult,
    workspaceId,
  ])

  const handleRemoveServer = useCallback(
    async (serverId: string) => {
      // Add server to deleting set
      setDeletingServers((prev) => new Set(prev).add(serverId))

      try {
        await deleteServer(workspaceId, serverId)
        await refreshTools(true) // Force refresh after removing server

        logger.info(`Removed MCP server: ${serverId}`)
      } catch (error) {
        logger.error('Failed to remove MCP server:', error)
        // Remove from deleting set on error so user can try again
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      } finally {
        // Remove from deleting set after successful deletion
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      }
    },
    [deleteServer, refreshTools, workspaceId]
  )

  // Load data on mount only
  useEffect(() => {
    fetchServers(workspaceId)
    refreshTools() // Don't force refresh on mount
  }, [fetchServers, refreshTools, workspaceId])

  const toolsByServer = (mcpTools || []).reduce(
    (acc, tool) => {
      if (!tool || !tool.serverId) {
        return acc // Skip invalid tools
      }
      if (!acc[tool.serverId]) {
        acc[tool.serverId] = []
      }
      acc[tool.serverId].push(tool)
      return acc
    },
    {} as Record<string, typeof mcpTools>
  )

  // Filter servers based on search term
  const filteredServers = (servers || []).filter((server) =>
    server.name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className='relative flex h-full flex-col'>
      {/* Fixed Header with Search */}
      <div className='px-6 pt-4 pb-2'>
        {/* Search Input */}
        {serversLoading ? (
          <Skeleton className='h-9 w-56 rounded-lg' />
        ) : (
          <div className='flex h-9 w-56 items-center gap-2 rounded-lg border bg-transparent pr-2 pl-3'>
            <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
            <Input
              placeholder='Search servers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
        )}

        {/* Error Alert */}
        {(toolsError || serversError) && (
          <Alert variant='destructive' className='mt-4'>
            <AlertCircle className='h-4 w-4' />
            <AlertDescription>{toolsError || serversError}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Scrollable Content */}
      <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='h-full space-y-4 py-2'>
          {/* Server List */}
          {serversLoading ? (
            <div className='space-y-4'>
              <McpServerSkeleton />
              <McpServerSkeleton />
              <McpServerSkeleton />
            </div>
          ) : !servers || servers.length === 0 ? (
            showAddForm ? (
              <div className='rounded-[8px] border bg-background p-4 shadow-xs'>
                <div className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <Label className='font-normal'>Server Name</Label>
                    </div>
                    <div className='w-[380px]'>
                      <Input
                        placeholder='e.g., My MCP Server'
                        value={formData.name}
                        onChange={(e) => {
                          if (testResult) clearTestResult()
                          setFormData((prev) => ({ ...prev, name: e.target.value }))
                        }}
                        className='h-9'
                      />
                    </div>
                  </div>

                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <Label className='font-normal'>Transport</Label>
                    </div>
                    <div className='w-[380px]'>
                      <Select
                        value={formData.transport}
                        onValueChange={(value: 'http' | 'sse' | 'streamable-http') => {
                          if (testResult) clearTestResult()
                          setFormData((prev) => ({ ...prev, transport: value }))
                        }}
                      >
                        <SelectTrigger className='h-9'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='streamable-http'>Streamable HTTP</SelectItem>
                          <SelectItem value='http'>HTTP</SelectItem>
                          <SelectItem value='sse'>Server-Sent Events</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <Label className='font-normal'>Server URL</Label>
                    </div>
                    <div className='relative w-[380px]'>
                      <Input
                        ref={urlInputRef}
                        placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
                        value={formData.url}
                        onChange={(e) => handleInputChange('url', e.target.value)}
                        onScroll={(e) => {
                          const scrollLeft = e.currentTarget.scrollLeft
                          setUrlScrollLeft(scrollLeft)
                        }}
                        onInput={(e) => {
                          const scrollLeft = e.currentTarget.scrollLeft
                          setUrlScrollLeft(scrollLeft)
                        }}
                        className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                      />
                      {/* Overlay for styled text display */}
                      <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                        <div
                          className='whitespace-nowrap'
                          style={{ transform: `translateX(-${urlScrollLeft}px)` }}
                        >
                          {formatDisplayText(formData.url || '', true)}
                        </div>
                      </div>

                      {/* Environment Variables Dropdown */}
                      {showEnvVars && activeInputField === 'url' && (
                        <EnvVarDropdown
                          visible={showEnvVars}
                          onSelect={handleEnvVarSelect}
                          searchTerm={envSearchTerm}
                          inputValue={formData.url || ''}
                          cursorPosition={cursorPosition}
                          workspaceId={workspaceId}
                          onClose={() => {
                            setShowEnvVars(false)
                            setActiveInputField(null)
                          }}
                          className='w-[380px]'
                          maxHeight='200px'
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 99999,
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {Object.entries(formData.headers || {}).map(([key, value], index) => (
                    <div key={index} className='relative flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <Label className='font-normal'>Header</Label>
                      </div>
                      <div className='relative flex w-[380px] gap-2'>
                        {/* Header Key Input */}
                        <div className='relative flex-1'>
                          <Input
                            placeholder='Name'
                            value={key}
                            onChange={(e) => handleInputChange('header-key', e.target.value, index)}
                            onScroll={(e) => {
                              const scrollLeft = e.currentTarget.scrollLeft
                              setHeaderScrollLeft((prev) => ({
                                ...prev,
                                [`key-${index}`]: scrollLeft,
                              }))
                            }}
                            onInput={(e) => {
                              const scrollLeft = e.currentTarget.scrollLeft
                              setHeaderScrollLeft((prev) => ({
                                ...prev,
                                [`key-${index}`]: scrollLeft,
                              }))
                            }}
                            className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                          />
                          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                            <div
                              className='whitespace-nowrap'
                              style={{
                                transform: `translateX(-${headerScrollLeft[`key-${index}`] || 0}px)`,
                              }}
                            >
                              {formatDisplayText(key || '', true)}
                            </div>
                          </div>
                        </div>

                        {/* Header Value Input */}
                        <div className='relative flex-1'>
                          <Input
                            placeholder='Value'
                            value={value}
                            onChange={(e) =>
                              handleInputChange('header-value', e.target.value, index)
                            }
                            onScroll={(e) => {
                              const scrollLeft = e.currentTarget.scrollLeft
                              setHeaderScrollLeft((prev) => ({
                                ...prev,
                                [`value-${index}`]: scrollLeft,
                              }))
                            }}
                            onInput={(e) => {
                              const scrollLeft = e.currentTarget.scrollLeft
                              setHeaderScrollLeft((prev) => ({
                                ...prev,
                                [`value-${index}`]: scrollLeft,
                              }))
                            }}
                            className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                          />
                          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                            <div
                              className='whitespace-nowrap'
                              style={{
                                transform: `translateX(-${headerScrollLeft[`value-${index}`] || 0}px)`,
                              }}
                            >
                              {formatDisplayText(value || '', true)}
                            </div>
                          </div>
                        </div>

                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            const newHeaders = { ...formData.headers }
                            delete newHeaders[key]
                            setFormData((prev) => ({ ...prev, headers: newHeaders }))
                          }}
                          className='h-9 w-9 p-0 text-muted-foreground hover:text-foreground'
                        >
                          <X className='h-3 w-3' />
                        </Button>

                        {/* Environment Variables Dropdown for Header Key */}
                        {showEnvVars &&
                          activeInputField === 'header-key' &&
                          activeHeaderIndex === index && (
                            <EnvVarDropdown
                              visible={showEnvVars}
                              onSelect={handleEnvVarSelect}
                              searchTerm={envSearchTerm}
                              inputValue={key}
                              cursorPosition={cursorPosition}
                              workspaceId={workspaceId}
                              onClose={() => {
                                setShowEnvVars(false)
                                setActiveInputField(null)
                                setActiveHeaderIndex(null)
                              }}
                              className='w-[380px]'
                              maxHeight='200px'
                              style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                zIndex: 99999,
                              }}
                            />
                          )}

                        {/* Environment Variables Dropdown for Header Value */}
                        {showEnvVars &&
                          activeInputField === 'header-value' &&
                          activeHeaderIndex === index && (
                            <EnvVarDropdown
                              visible={showEnvVars}
                              onSelect={handleEnvVarSelect}
                              searchTerm={envSearchTerm}
                              inputValue={value}
                              cursorPosition={cursorPosition}
                              workspaceId={workspaceId}
                              onClose={() => {
                                setShowEnvVars(false)
                                setActiveInputField(null)
                                setActiveHeaderIndex(null)
                              }}
                              className='w-[380px]'
                              maxHeight='200px'
                              style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                zIndex: 99999,
                              }}
                            />
                          )}
                      </div>
                    </div>
                  ))}

                  <div className='flex items-center justify-between'>
                    <div />
                    <div className='w-[380px]'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() => {
                          setFormData((prev) => ({
                            ...prev,
                            headers: { ...prev.headers, '': '' },
                          }))
                        }}
                        className='h-9 text-muted-foreground hover:text-foreground'
                      >
                        <Plus className='mr-2 h-3 w-3' />
                        Add Header
                      </Button>
                    </div>
                  </div>

                  <div className='border-t pt-4'>
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={handleTestConnection}
                          disabled={
                            isTestingConnection || !formData.name.trim() || !formData.url?.trim()
                          }
                          className='text-muted-foreground hover:text-foreground'
                        >
                          {isTestingConnection ? 'Testing...' : 'Test Connection'}
                        </Button>
                        {testResult?.success && (
                          <span className='text-green-600 text-xs'>✓ Connected</span>
                        )}
                      </div>
                      <div className='flex items-center gap-2'>
                        {testResult && !testResult.success && (
                          <span className='ml-4 text-red-600 text-xs'>
                            {testResult.error || testResult.message}
                          </span>
                        )}
                        <Button variant='ghost' size='sm' onClick={() => setShowAddForm(false)}>
                          Cancel
                        </Button>
                        <Button
                          size='sm'
                          onClick={handleAddServer}
                          disabled={
                            serversLoading ||
                            isAddingServer ||
                            !formData.name.trim() ||
                            !formData.url?.trim()
                          }
                        >
                          {serversLoading || isAddingServer ? 'Adding...' : 'Add Server'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              !showAddForm && (
                <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
                  Click "Add Server" below to get started
                </div>
              )
            )
          ) : (
            <div className='space-y-4'>
              {filteredServers.map((server: any) => {
                // Add defensive checks for server properties
                if (!server || !server.id) {
                  return null
                }

                const tools = toolsByServer[server.id] || []

                return (
                  <div key={server.id} className='flex flex-col gap-2'>
                    <div className='flex items-center justify-between gap-4'>
                      <div className='flex items-center gap-3'>
                        <div className='flex h-8 items-center rounded-[8px] bg-muted px-3'>
                          <code className='font-mono text-foreground text-xs'>
                            {server.name || 'Unnamed Server'}
                          </code>
                        </div>
                        <span className='text-muted-foreground text-xs'>
                          {server.transport?.toUpperCase() || 'HTTP'}
                        </span>
                        <span className='text-muted-foreground text-xs'>•</span>
                        <span className='text-muted-foreground text-xs'>
                          {tools.length} tool{tools.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleRemoveServer(server.id)}
                        disabled={deletingServers.has(server.id)}
                        className='h-8 text-muted-foreground hover:text-foreground'
                      >
                        {deletingServers.has(server.id) ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                    {tools.length > 0 && (
                      <div className='mt-1 ml-2 flex flex-wrap gap-1'>
                        {tools.map((tool) => (
                          <span
                            key={tool.id}
                            className='inline-flex h-5 items-center rounded bg-muted/50 px-2 text-muted-foreground text-xs'
                          >
                            {tool.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Show message when search has no results but there are servers */}
              {searchTerm.trim() && filteredServers.length === 0 && servers.length > 0 && (
                <div className='py-8 text-center text-muted-foreground text-sm'>
                  No servers found matching "{searchTerm}"
                </div>
              )}

              {/* Add Server Form for when servers exist */}
              {showAddForm && (
                <div className='mt-4 rounded-[8px] border bg-background p-4 shadow-xs'>
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <Label className='font-normal'>Server Name</Label>
                      </div>
                      <div className='w-[380px]'>
                        <Input
                          placeholder='e.g., My MCP Server'
                          value={formData.name}
                          onChange={(e) => {
                            if (testResult) clearTestResult()
                            setFormData((prev) => ({ ...prev, name: e.target.value }))
                          }}
                          className='h-9'
                        />
                      </div>
                    </div>

                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <Label className='font-normal'>Transport</Label>
                      </div>
                      <div className='w-[380px]'>
                        <Select
                          value={formData.transport}
                          onValueChange={(value: 'http' | 'sse' | 'streamable-http') => {
                            if (testResult) clearTestResult()
                            setFormData((prev) => ({ ...prev, transport: value }))
                          }}
                        >
                          <SelectTrigger className='h-9'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='streamable-http'>Streamable HTTP</SelectItem>
                            <SelectItem value='http'>HTTP</SelectItem>
                            <SelectItem value='sse'>Server-Sent Events</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <Label className='font-normal'>Server URL</Label>
                      </div>
                      <div className='relative w-[380px]'>
                        <Input
                          ref={urlInputRef}
                          placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
                          value={formData.url}
                          onChange={(e) => handleInputChange('url', e.target.value)}
                          onScroll={(e) => {
                            const scrollLeft = e.currentTarget.scrollLeft
                            setUrlScrollLeft(scrollLeft)
                          }}
                          onInput={(e) => {
                            const scrollLeft = e.currentTarget.scrollLeft
                            setUrlScrollLeft(scrollLeft)
                          }}
                          className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                        />
                        {/* Overlay for styled text display */}
                        <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                          <div
                            className='whitespace-nowrap'
                            style={{ transform: `translateX(-${urlScrollLeft}px)` }}
                          >
                            {formatDisplayText(formData.url || '', true)}
                          </div>
                        </div>

                        {/* Environment Variables Dropdown */}
                        {showEnvVars && activeInputField === 'url' && (
                          <EnvVarDropdown
                            visible={showEnvVars}
                            onSelect={handleEnvVarSelect}
                            searchTerm={envSearchTerm}
                            inputValue={formData.url || ''}
                            cursorPosition={cursorPosition}
                            workspaceId={workspaceId}
                            onClose={() => {
                              setShowEnvVars(false)
                              setActiveInputField(null)
                            }}
                            className='w-[380px]'
                            maxHeight='180px'
                            style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              zIndex: 99999,
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {Object.entries(formData.headers || {}).map(([key, value], index) => (
                      <div key={index} className='relative flex items-center justify-between'>
                        <div className='flex items-center gap-2'>
                          <Label className='font-normal'>Header</Label>
                        </div>
                        <div className='relative flex w-[380px] gap-2'>
                          {/* Header Key Input */}
                          <div className='relative flex-1'>
                            <Input
                              placeholder='Name'
                              value={key}
                              onChange={(e) =>
                                handleInputChange('header-key', e.target.value, index)
                              }
                              onScroll={(e) => {
                                const scrollLeft = e.currentTarget.scrollLeft
                                setHeaderScrollLeft((prev) => ({
                                  ...prev,
                                  [`key-${index}`]: scrollLeft,
                                }))
                              }}
                              onInput={(e) => {
                                const scrollLeft = e.currentTarget.scrollLeft
                                setHeaderScrollLeft((prev) => ({
                                  ...prev,
                                  [`key-${index}`]: scrollLeft,
                                }))
                              }}
                              className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                            />
                            <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                              <div
                                className='whitespace-nowrap'
                                style={{
                                  transform: `translateX(-${headerScrollLeft[`key-${index}`] || 0}px)`,
                                }}
                              >
                                {formatDisplayText(key || '', true)}
                              </div>
                            </div>
                          </div>

                          {/* Header Value Input */}
                          <div className='relative flex-1'>
                            <Input
                              placeholder='Value'
                              value={value}
                              onChange={(e) =>
                                handleInputChange('header-value', e.target.value, index)
                              }
                              onScroll={(e) => {
                                const scrollLeft = e.currentTarget.scrollLeft
                                setHeaderScrollLeft((prev) => ({
                                  ...prev,
                                  [`value-${index}`]: scrollLeft,
                                }))
                              }}
                              onInput={(e) => {
                                const scrollLeft = e.currentTarget.scrollLeft
                                setHeaderScrollLeft((prev) => ({
                                  ...prev,
                                  [`value-${index}`]: scrollLeft,
                                }))
                              }}
                              className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                            />
                            <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                              <div
                                className='whitespace-nowrap'
                                style={{
                                  transform: `translateX(-${headerScrollLeft[`value-${index}`] || 0}px)`,
                                }}
                              >
                                {formatDisplayText(value || '', true)}
                              </div>
                            </div>
                          </div>

                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => {
                              const newHeaders = { ...formData.headers }
                              delete newHeaders[key]
                              setFormData((prev) => ({ ...prev, headers: newHeaders }))
                            }}
                            className='h-9 w-9 p-0 text-muted-foreground hover:text-foreground'
                          >
                            <X className='h-3 w-3' />
                          </Button>

                          {/* Environment Variables Dropdown for Header Key */}
                          {showEnvVars &&
                            activeInputField === 'header-key' &&
                            activeHeaderIndex === index && (
                              <EnvVarDropdown
                                visible={showEnvVars}
                                onSelect={handleEnvVarSelect}
                                searchTerm={envSearchTerm}
                                inputValue={key}
                                cursorPosition={cursorPosition}
                                workspaceId={workspaceId}
                                onClose={() => {
                                  setShowEnvVars(false)
                                  setActiveInputField(null)
                                  setActiveHeaderIndex(null)
                                }}
                                className='w-[380px]'
                                maxHeight='200px'
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  zIndex: 99999,
                                }}
                              />
                            )}

                          {/* Environment Variables Dropdown for Header Value */}
                          {showEnvVars &&
                            activeInputField === 'header-value' &&
                            activeHeaderIndex === index && (
                              <EnvVarDropdown
                                visible={showEnvVars}
                                onSelect={handleEnvVarSelect}
                                searchTerm={envSearchTerm}
                                inputValue={value}
                                cursorPosition={cursorPosition}
                                workspaceId={workspaceId}
                                onClose={() => {
                                  setShowEnvVars(false)
                                  setActiveInputField(null)
                                  setActiveHeaderIndex(null)
                                }}
                                className='w-[380px]'
                                maxHeight='200px'
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  zIndex: 99999,
                                }}
                              />
                            )}
                        </div>
                      </div>
                    ))}

                    <div className='flex items-center justify-between'>
                      <div />
                      <div className='w-[380px]'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              headers: { ...prev.headers, '': '' },
                            }))
                          }}
                          className='h-9 text-muted-foreground hover:text-foreground'
                        >
                          <Plus className='mr-2 h-3 w-3' />
                          Add Header
                        </Button>
                      </div>
                    </div>

                    <div className='border-t pt-4'>
                      <div className='flex items-center justify-between'>
                        <div className='flex items-center gap-2'>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={handleTestConnection}
                            disabled={
                              isTestingConnection || !formData.name.trim() || !formData.url?.trim()
                            }
                            className='text-muted-foreground hover:text-foreground'
                          >
                            {isTestingConnection ? 'Testing...' : 'Test Connection'}
                          </Button>
                          {testResult?.success && (
                            <span className='text-green-600 text-xs'>✓ Connected</span>
                          )}
                        </div>
                        <div className='flex items-center gap-2'>
                          {testResult && !testResult.success && (
                            <span className='ml-4 text-red-600 text-xs'>
                              {testResult.error || testResult.message}
                            </span>
                          )}
                          <Button variant='ghost' size='sm' onClick={() => setShowAddForm(false)}>
                            Cancel
                          </Button>
                          <Button
                            size='sm'
                            onClick={handleAddServer}
                            disabled={
                              serversLoading ||
                              isAddingServer ||
                              !formData.name.trim() ||
                              !formData.url?.trim()
                            }
                          >
                            {serversLoading || isAddingServer ? 'Adding...' : 'Add Server'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className='bg-background'>
        <div className='flex w-full items-center justify-between px-6 py-4'>
          {serversLoading ? (
            <>
              <Skeleton className='h-9 w-[117px] rounded-[8px]' />
              <div className='w-[200px]' />
            </>
          ) : (
            <>
              <Button
                onClick={() => setShowAddForm(!showAddForm)}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                disabled={serversLoading}
              >
                <Plus className='h-4 w-4 stroke-[2px]' />
                Add Server
              </Button>
              <div className='text-muted-foreground text-xs'>
                Configure MCP servers to extend workflow capabilities
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function McpServerSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-40 rounded-[8px]' /> {/* Server name */}
          <Skeleton className='h-4 w-16' /> {/* Transport type */}
          <Skeleton className='h-1 w-1 rounded-full' /> {/* Dot separator */}
          <Skeleton className='h-4 w-12' /> {/* Tool count */}
        </div>
        <Skeleton className='h-8 w-16' /> {/* Delete button */}
      </div>
      <div className='mt-1 ml-2 flex flex-wrap gap-1'>
        <Skeleton className='h-5 w-16 rounded' /> {/* Tool name 1 */}
        <Skeleton className='h-5 w-20 rounded' /> {/* Tool name 2 */}
        <Skeleton className='h-5 w-14 rounded' /> {/* Tool name 3 */}
      </div>
    </div>
  )
}
