'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Plus, Trash2, WrenchIcon, X } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        <div className='space-y-6 p-6'>
          {/* Header */}
          <div>
            <h2 className='font-semibold text-xl'>MCP Servers</h2>
            <p className='mt-1 text-muted-foreground text-sm'>
              Manage Model Context Protocol servers to extend your workflow capabilities with
              external tools.
            </p>
          </div>

          {/* Error Alert */}
          {(toolsError || serversError) && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>{toolsError || serversError}</AlertDescription>
            </Alert>
          )}

          {/* Add Server Button */}
          <div className='flex items-center justify-between'>
            <h3 className='font-medium text-lg'>Configured Servers</h3>
            <Button onClick={() => setShowAddForm(!showAddForm)} variant='outline' size='sm'>
              <Plus className='mr-2 h-4 w-4' />
              Add Server
            </Button>
          </div>

          {/* Add Server Form */}
          {showAddForm && (
            <Card>
              <CardHeader>
                <CardTitle>Add MCP Server</CardTitle>
                <CardDescription>Configure a new Model Context Protocol server</CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='grid grid-cols-2 gap-4'>
                  <div>
                    <Label htmlFor='server-name'>Server Name</Label>
                    <Input
                      id='server-name'
                      placeholder='e.g., Firecrawl MCP'
                      value={formData.name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor='transport'>Transport Type</Label>
                    <Select
                      value={formData.transport}
                      onValueChange={(value: 'http' | 'sse') =>
                        setFormData((prev) => ({ ...prev, transport: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='http'>HTTP</SelectItem>
                        <SelectItem value='sse'>Server-Sent Events</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor='server-url'>Server URL</Label>
                  <Input
                    id='server-url'
                    placeholder='https://mcp.firecrawl.dev/YOUR_API_KEY/sse'
                    value={formData.url}
                    onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
                  />
                </div>

                <div>
                  <Label>Headers (Optional)</Label>
                  <div className='space-y-2'>
                    {Object.entries(formData.headers || {}).map(([key, value], index) => (
                      <div key={index} className='flex gap-2'>
                        <Input
                          placeholder='Header name (e.g., Authorization)'
                          value={key}
                          onChange={(e) => {
                            const newHeaders = { ...formData.headers }
                            delete newHeaders[key]
                            newHeaders[e.target.value] = value
                            setFormData((prev) => ({ ...prev, headers: newHeaders }))
                          }}
                          className='flex-1'
                        />
                        <Input
                          placeholder='Header value (e.g., Bearer token)'
                          value={value}
                          onChange={(e) => {
                            setFormData((prev) => ({
                              ...prev,
                              headers: { ...prev.headers, [key]: e.target.value },
                            }))
                          }}
                          className='flex-1'
                        />
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => {
                            const newHeaders = { ...formData.headers }
                            delete newHeaders[key]
                            setFormData((prev) => ({ ...prev, headers: newHeaders }))
                          }}
                        >
                          <X className='h-4 w-4' />
                        </Button>
                      </div>
                    ))}
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
                    >
                      <Plus className='mr-2 h-4 w-4' />
                      Add Header
                    </Button>
                  </div>
                </div>

                <div className='flex justify-end gap-2'>
                  <Button variant='outline' onClick={() => setShowAddForm(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddServer}
                    disabled={serversLoading || !formData.name.trim()}
                  >
                    {serversLoading ? 'Adding...' : 'Add Server'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Server List */}
          <div className='space-y-4'>
            {serversLoading ? (
              <div className='flex justify-center py-8'>
                <div className='text-muted-foreground text-sm'>Loading servers...</div>
              </div>
            ) : !servers || servers.length === 0 ? (
              <Card>
                <CardContent className='flex flex-col items-center justify-center py-12'>
                  <WrenchIcon className='mb-4 h-12 w-12 text-muted-foreground' />
                  <h3 className='mb-2 font-medium text-lg'>No MCP Servers</h3>
                  <p className='mb-4 text-center text-muted-foreground text-sm'>
                    Add your first MCP server to start using external tools in your workflows.
                  </p>
                  <Button onClick={() => setShowAddForm(true)} size='sm'>
                    <Plus className='mr-2 h-4 w-4' />
                    Add Server
                  </Button>
                </CardContent>
              </Card>
            ) : (
              (servers || []).map((server: any) => {
                // Add defensive checks for server properties
                if (!server || !server.id) {
                  return null
                }

                const tools = toolsByServer[server.id] || []

                return (
                  <Card key={server.id}>
                    <CardHeader>
                      <div className='flex items-center justify-between'>
                        <div>
                          <CardTitle className='flex items-center gap-2'>
                            {server.name || 'Unnamed Server'}
                            {server.transport && (
                              <Badge variant='outline' className='text-xs'>
                                {server.transport.toUpperCase()}
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription>{server.url || 'No URL configured'}</CardDescription>
                        </div>
                        <div className='flex items-center gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => handleRemoveServer(server.id)}
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div>
                        <h4 className='mb-2 font-medium text-sm'>
                          Available Tools ({tools.length})
                        </h4>
                        {tools.length > 0 ? (
                          <div className='flex flex-wrap gap-2'>
                            {tools.map((tool) => (
                              <Badge key={tool.id} variant='secondary' className='text-xs'>
                                {tool.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className='text-muted-foreground text-sm'>
                            {toolsLoading ? 'Loading tools...' : 'No tools discovered'}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>

          {/* Tool Summary */}
          {mcpTools && mcpTools.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tool Summary</CardTitle>
                <CardDescription>All tools available across your MCP servers</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='text-muted-foreground text-sm'>
                  <strong>{mcpTools.length}</strong> tools available from{' '}
                  <strong>{Object.keys(toolsByServer).length}</strong> servers
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
