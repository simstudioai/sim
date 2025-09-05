'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Plus, Search, X } from 'lucide-react'
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
import { createLogger } from '@/lib/logs/console/logger'
import { useMcpTools } from '@/hooks/use-mcp-tools'
import { useMcpServersStore } from '@/stores/mcp-servers/store'

const logger = createLogger('McpSettings')

interface McpServerFormData {
  name: string
  transport: 'http' | 'sse'
  url?: string
  timeout?: number
  headers?: Record<string, string>
}

export function MCP() {
  const { mcpTools, isLoading: toolsLoading, error: toolsError, refreshTools } = useMcpTools()
  const {
    servers,
    isLoading: serversLoading,
    error: serversError,
    fetchServers,
    createServer,
    deleteServer,
    clearError,
  } = useMcpServersStore()

  const [showAddForm, setShowAddForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [formData, setFormData] = useState<McpServerFormData>({
    name: '',
    transport: 'http',
    url: '',
    timeout: 30000,
    headers: {},
  })

  const handleAddServer = useCallback(async () => {
    if (!formData.name.trim()) return

    try {
      await createServer({
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url,
        timeout: formData.timeout || 30000,
        headers: formData.headers,
        enabled: true,
      })

      // Reset form and refresh data
      setFormData({
        name: '',
        transport: 'http',
        url: '',
        timeout: 30000,
        headers: {},
      })
      setShowAddForm(false)
      await refreshTools(true) // Force refresh after adding server

      logger.info(`Added MCP server: ${formData.name}`)
    } catch (error) {
      logger.error('Failed to add MCP server:', error)
    }
  }, [formData, createServer, refreshTools])

  const handleRemoveServer = useCallback(
    async (serverId: string) => {
      try {
        await deleteServer(serverId)
        await refreshTools(true) // Force refresh after removing server

        logger.info(`Removed MCP server: ${serverId}`)
      } catch (error) {
        logger.error('Failed to remove MCP server:', error)
      }
    },
    [deleteServer, refreshTools]
  )

  // Load data on mount only
  useEffect(() => {
    fetchServers()
    refreshTools() // Don't force refresh on mount
  }, [fetchServers, refreshTools])

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
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              Click "Add Server" below to get started
            </div>
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
                        className='h-8 text-muted-foreground hover:text-foreground'
                      >
                        Delete
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
            </div>
          )}

          {/* Add Server Form */}
          {showAddForm && (
            <div className='rounded-[8px] border bg-background p-4 shadow-xs'>
              <div className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Label className='font-normal'>Server Name</Label>
                  </div>
                  <div className='w-[320px]'>
                    <Input
                      placeholder='e.g., Firecrawl MCP'
                      value={formData.name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                      className='h-9'
                    />
                  </div>
                </div>

                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Label className='font-normal'>Transport</Label>
                  </div>
                  <div className='w-[320px]'>
                    <Select
                      value={formData.transport}
                      onValueChange={(value: 'http' | 'sse') =>
                        setFormData((prev) => ({ ...prev, transport: value }))
                      }
                    >
                      <SelectTrigger className='h-9'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
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
                  <div className='w-[320px]'>
                    <Input
                      placeholder='https://mcp.server.dev/sse'
                      value={formData.url}
                      onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
                      className='h-9'
                    />
                  </div>
                </div>

                {Object.entries(formData.headers || {}).map(([key, value], index) => (
                  <div key={index} className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <Label className='font-normal'>Header</Label>
                    </div>
                    <div className='flex w-[320px] gap-1'>
                      <Input
                        placeholder='Name'
                        value={key}
                        onChange={(e) => {
                          const newHeaders = { ...formData.headers }
                          delete newHeaders[key]
                          newHeaders[e.target.value] = value
                          setFormData((prev) => ({ ...prev, headers: newHeaders }))
                        }}
                        className='h-9 flex-1'
                      />
                      <Input
                        placeholder='Value'
                        value={value}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            headers: { ...prev.headers, [key]: e.target.value },
                          }))
                        }}
                        className='h-9 flex-1'
                      />
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
                    </div>
                  </div>
                ))}

                <div className='flex items-center justify-between'>
                  <div />
                  <div className='w-[320px]'>
                    <div className='flex gap-2'>
                      <Button
                        type='button'
                        variant='ghost'
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
                </div>

                <div className='border-t pt-4'>
                  <div className='flex items-center justify-between'>
                    <div />
                    <div className='flex gap-2'>
                      <Button variant='ghost' size='sm' onClick={() => setShowAddForm(false)}>
                        Cancel
                      </Button>
                      <Button
                        size='sm'
                        onClick={handleAddServer}
                        disabled={serversLoading || !formData.name.trim()}
                      >
                        {serversLoading ? 'Adding...' : 'Add Server'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
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
      <Skeleton className='h-4 w-24' /> {/* Server label */}
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-40 rounded-[8px]' /> {/* Server name */}
          <Skeleton className='h-5 w-12 rounded' /> {/* Transport badge */}
          <Skeleton className='h-4 w-16' /> {/* Tool count */}
        </div>
        <Skeleton className='h-8 w-16' /> {/* Delete button */}
      </div>
    </div>
  )
}
