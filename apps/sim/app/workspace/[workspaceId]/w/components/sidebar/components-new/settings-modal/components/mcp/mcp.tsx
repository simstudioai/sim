'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { Alert, AlertDescription, Input, Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { checkEnvVarTrigger } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import { AddServerForm } from './components/add-server-form'
import type { McpServerFormData } from './types'

const logger = createLogger('McpSettings')

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

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envSearchTerm, setEnvSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<
    'url' | 'header-key' | 'header-value' | null
  >(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  const [isAddingServer, setIsAddingServer] = useState(false)

  const [urlScrollLeft, setUrlScrollLeft] = useState(0)
  const [headerScrollLeft, setHeaderScrollLeft] = useState<Record<string, number>>({})

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

  const handleInputChange = useCallback(
    (field: 'url' | 'header-key' | 'header-value', value: string, headerIndex?: number) => {
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
        setActiveInputField(null)
        setActiveHeaderIndex(null)
      }

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
      if (!testResult) {
        const result = await testConnection({
          name: formData.name,
          transport: formData.transport,
          url: formData.url,
          headers: formData.headers,
          timeout: formData.timeout,
          workspaceId,
        })

        if (!result.success) {
          return
        }
      }

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

      setFormData({
        name: '',
        transport: 'streamable-http',
        url: '',
        timeout: 30000,
        headers: {},
      })
      setShowAddForm(false)
      setShowEnvVars(false)
      setActiveInputField(null)
      setActiveHeaderIndex(null)
      clearTestResult()

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
      setDeletingServers((prev) => new Set(prev).add(serverId))

      try {
        await deleteServer(workspaceId, serverId)
        await refreshTools(true)

        logger.info(`Removed MCP server: ${serverId}`)
      } catch (error) {
        logger.error('Failed to remove MCP server:', error)
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      } finally {
        setDeletingServers((prev) => {
          const newSet = new Set(prev)
          newSet.delete(serverId)
          return newSet
        })
      }
    },
    [deleteServer, refreshTools, workspaceId]
  )

  useEffect(() => {
    fetchServers(workspaceId)
    refreshTools()
  }, [fetchServers, refreshTools, workspaceId])

  const toolsByServer = (mcpTools || []).reduce(
    (acc, tool) => {
      if (!tool || !tool.serverId) {
        return acc
      }
      if (!acc[tool.serverId]) {
        acc[tool.serverId] = []
      }
      acc[tool.serverId].push(tool)
      return acc
    },
    {} as Record<string, typeof mcpTools>
  )

  const filteredServers = (servers || []).filter((server) =>
    server.name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className='relative flex h-full flex-col'>
      {/* Fixed Header with Search */}
      <div className='px-6 pt-4 pb-2'>
        {/* Search Input */}
        {serversLoading ? (
          <Skeleton className='h-9 w-56 rounded-[8px]' />
        ) : (
          <div className='flex h-9 w-56 items-center gap-2 rounded-[8px] border bg-transparent pr-2 pl-3'>
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
      <div className='min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='space-y-2 pt-2 pb-6'>
          {/* Server List */}
          {serversLoading ? (
            <div className='space-y-2'>
              <McpServerSkeleton />
              <McpServerSkeleton />
              <McpServerSkeleton />
            </div>
          ) : !servers || servers.length === 0 ? (
            showAddForm ? (
              <AddServerForm
                formData={formData}
                testResult={testResult}
                isTestingConnection={isTestingConnection}
                isAddingServer={isAddingServer}
                serversLoading={serversLoading}
                showEnvVars={showEnvVars}
                activeInputField={activeInputField}
                activeHeaderIndex={activeHeaderIndex}
                envSearchTerm={envSearchTerm}
                cursorPosition={cursorPosition}
                urlScrollLeft={urlScrollLeft}
                headerScrollLeft={headerScrollLeft}
                workspaceId={workspaceId}
                urlInputRef={urlInputRef}
                onNameChange={(value) => setFormData((prev) => ({ ...prev, name: value }))}
                onInputChange={handleInputChange}
                onUrlScroll={(scrollLeft) => setUrlScrollLeft(scrollLeft)}
                onHeaderScroll={(key, scrollLeft) =>
                  setHeaderScrollLeft((prev) => ({ ...prev, [key]: scrollLeft }))
                }
                onEnvVarSelect={handleEnvVarSelect}
                onEnvVarClose={() => {
                  setShowEnvVars(false)
                  setActiveInputField(null)
                  setActiveHeaderIndex(null)
                }}
                onAddHeader={() =>
                  setFormData((prev) => ({ ...prev, headers: { ...prev.headers, '': '' } }))
                }
                onRemoveHeader={(key) => {
                  const newHeaders = { ...formData.headers }
                  delete newHeaders[key]
                  setFormData((prev) => ({ ...prev, headers: newHeaders }))
                }}
                onTestConnection={handleTestConnection}
                onCancel={() => setShowAddForm(false)}
                onAddServer={handleAddServer}
                onClearTestResult={clearTestResult}
              />
            ) : (
              !showAddForm && (
                <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
                  Click "Add Server" below to get started
                </div>
              )
            )
          ) : (
            <div className='space-y-2'>
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
                <div className='mt-2'>
                  <AddServerForm
                    formData={formData}
                    testResult={testResult}
                    isTestingConnection={isTestingConnection}
                    isAddingServer={isAddingServer}
                    serversLoading={serversLoading}
                    showEnvVars={showEnvVars}
                    activeInputField={activeInputField}
                    activeHeaderIndex={activeHeaderIndex}
                    envSearchTerm={envSearchTerm}
                    cursorPosition={cursorPosition}
                    urlScrollLeft={urlScrollLeft}
                    headerScrollLeft={headerScrollLeft}
                    workspaceId={workspaceId}
                    urlInputRef={urlInputRef}
                    onNameChange={(value) => setFormData((prev) => ({ ...prev, name: value }))}
                    onInputChange={handleInputChange}
                    onUrlScroll={(scrollLeft) => setUrlScrollLeft(scrollLeft)}
                    onHeaderScroll={(key, scrollLeft) =>
                      setHeaderScrollLeft((prev) => ({ ...prev, [key]: scrollLeft }))
                    }
                    onEnvVarSelect={handleEnvVarSelect}
                    onEnvVarClose={() => {
                      setShowEnvVars(false)
                      setActiveInputField(null)
                      setActiveHeaderIndex(null)
                    }}
                    onAddHeader={() =>
                      setFormData((prev) => ({ ...prev, headers: { ...prev.headers, '': '' } }))
                    }
                    onRemoveHeader={(key) => {
                      const newHeaders = { ...formData.headers }
                      delete newHeaders[key]
                      setFormData((prev) => ({ ...prev, headers: newHeaders }))
                    }}
                    onTestConnection={handleTestConnection}
                    onCancel={() => setShowAddForm(false)}
                    onAddServer={handleAddServer}
                    onClearTestResult={clearTestResult}
                  />
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
