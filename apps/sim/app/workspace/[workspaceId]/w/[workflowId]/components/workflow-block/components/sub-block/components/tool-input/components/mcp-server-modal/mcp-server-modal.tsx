'use client'

import { useCallback, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createLogger } from '@/lib/logs/console/logger'
import { useMcpServerTest } from '@/hooks/use-mcp-server-test'
import { useMcpServersStore } from '@/stores/mcp-servers/store'

const logger = createLogger('McpServerModal')

interface McpServerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onServerCreated?: () => void
}

interface McpServerFormData {
  name: string
  transport: 'http' | 'sse' | 'streamable-http'
  url?: string
  headers?: Record<string, string>
}

export function McpServerModal({ open, onOpenChange, onServerCreated }: McpServerModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [formData, setFormData] = useState<McpServerFormData>({
    name: '',
    transport: 'streamable-http',
    url: '',
    headers: { '': '' },
  })
  const { createServer, isLoading, error: storeError, clearError } = useMcpServersStore()
  const [localError, setLocalError] = useState<string | null>(null)

  // MCP server testing
  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  // Environment variable dropdown state
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<
    'url' | 'header-key' | 'header-value' | null
  >(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const error = localError || storeError

  const resetForm = () => {
    setFormData({
      name: '',
      transport: 'streamable-http',
      url: '',
      headers: { '': '' },
    })
    setLocalError(null)
    clearError()
    setShowEnvVars(false)
    setActiveInputField(null)
    setActiveHeaderIndex(null)
    clearTestResult()
  }

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
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

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

        // Add a new empty header row if this is the last row and both key and value have content
        const isLastRow = headerIndex === headerEntries.length - 1
        const hasContent = value.trim() !== '' && headerValue.trim() !== ''
        if (isLastRow && hasContent) {
          newHeaders[''] = ''
        }

        setFormData((prev) => ({ ...prev, headers: newHeaders }))
      } else if (field === 'header-value' && headerIndex !== undefined) {
        const headerEntries = Object.entries(formData.headers || {})
        const [key] = headerEntries[headerIndex]
        const newHeaders = { ...formData.headers, [key]: value }

        // Add a new empty header row if this is the last row and both key and value have content
        const isLastRow = headerIndex === headerEntries.length - 1
        const hasContent = key.trim() !== '' && value.trim() !== ''
        if (isLastRow && hasContent) {
          newHeaders[''] = ''
        }

        setFormData((prev) => ({ ...prev, headers: newHeaders }))
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
      timeout: 30000,
    })
  }, [formData, testConnection])

  const handleSubmit = useCallback(async () => {
    if (!formData.name.trim()) {
      setLocalError('Server name is required')
      return
    }

    if (!formData.url?.trim()) {
      setLocalError('Server URL is required for HTTP/SSE transport')
      return
    }

    setLocalError(null)
    clearError()

    try {
      // If no test has been done, test first
      if (!testResult) {
        const result = await testConnection({
          name: formData.name,
          transport: formData.transport,
          url: formData.url,
          headers: formData.headers,
          timeout: 30000,
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

      // Filter out empty headers
      const cleanHeaders = Object.fromEntries(
        Object.entries(formData.headers || {}).filter(
          ([key, value]) => key.trim() !== '' && value.trim() !== ''
        )
      )

      await createServer({
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url,
        timeout: 30000,
        headers: cleanHeaders,
        enabled: true,
      })

      logger.info(`Added MCP server: ${formData.name}`)

      // Close modal and reset form immediately after successful creation
      resetForm()
      onOpenChange(false)
      onServerCreated?.()
    } catch (error) {
      logger.error('Failed to add MCP server:', error)
      setLocalError(error instanceof Error ? error.message : 'Failed to add MCP server')
    }
  }, [
    formData,
    testResult,
    testConnection,
    onOpenChange,
    onServerCreated,
    createServer,
    clearError,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[600px]'>
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Configure a new Model Context Protocol server to extend your workflow capabilities.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <Label htmlFor='server-name'>Server Name</Label>
              <Input
                id='server-name'
                placeholder='e.g., My MCP Server'
                value={formData.name}
                onChange={(e) => {
                  if (testResult) clearTestResult()
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }}
              />
            </div>
            <div>
              <Label htmlFor='transport'>Transport Type</Label>
              <Select
                value={formData.transport}
                onValueChange={(value: 'http' | 'sse' | 'streamable-http') => {
                  if (testResult) clearTestResult()
                  setFormData((prev) => ({
                    ...prev,
                    transport: value,
                  }))
                }}
              >
                <SelectTrigger>
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

          <div className='relative'>
            <Label htmlFor='server-url'>Server URL</Label>
            <Input
              ref={urlInputRef}
              id='server-url'
              placeholder='https://mcp.firecrawl.dev/{{YOUR_API_KEY}}/sse'
              value={formData.url}
              onChange={(e) => handleInputChange('url', e.target.value)}
            />

            {/* Environment Variables Dropdown */}
            {showEnvVars && activeInputField === 'url' && (
              <EnvVarDropdown
                visible={showEnvVars}
                onSelect={handleEnvVarSelect}
                searchTerm={searchTerm}
                inputValue={formData.url || ''}
                cursorPosition={cursorPosition}
                workspaceId={workspaceId}
                onClose={() => {
                  setShowEnvVars(false)
                  setActiveInputField(null)
                }}
                className='w-full'
              />
            )}
          </div>

          <div>
            <Label>Headers (Optional)</Label>
            <div className='space-y-2'>
              {Object.entries(formData.headers || {}).map(([key, value], index) => (
                <div key={index} className='relative flex gap-2'>
                  {/* Header Name Input */}
                  <div className='flex-1'>
                    <Input
                      placeholder='Header name'
                      value={key}
                      onChange={(e) => handleInputChange('header-key', e.target.value, index)}
                    />
                  </div>

                  {/* Header Value Input */}
                  <div className='flex-1'>
                    <Input
                      placeholder='Header value'
                      value={value}
                      onChange={(e) => handleInputChange('header-value', e.target.value, index)}
                    />
                  </div>

                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => {
                      const headerEntries = Object.entries(formData.headers || {})
                      if (headerEntries.length === 1) {
                        // If this is the only header, just clear it instead of deleting
                        setFormData((prev) => ({ ...prev, headers: { '': '' } }))
                      } else {
                        // Delete this header
                        const newHeaders = { ...formData.headers }
                        delete newHeaders[key]
                        setFormData((prev) => ({ ...prev, headers: newHeaders }))
                      }
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
                        searchTerm={searchTerm}
                        inputValue={key}
                        cursorPosition={cursorPosition}
                        workspaceId={workspaceId}
                        onClose={() => {
                          setShowEnvVars(false)
                          setActiveInputField(null)
                          setActiveHeaderIndex(null)
                        }}
                        className='w-full'
                        maxHeight='200px'
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          zIndex: 9999,
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
                        searchTerm={searchTerm}
                        inputValue={value}
                        cursorPosition={cursorPosition}
                        workspaceId={workspaceId}
                        onClose={() => {
                          setShowEnvVars(false)
                          setActiveInputField(null)
                          setActiveHeaderIndex(null)
                        }}
                        className='w-full'
                        maxHeight='200px'
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          zIndex: 9999,
                        }}
                      />
                    )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className='rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm'>
              {error}
            </div>
          )}

          {/* Test Connection */}
          <div className='border-t pt-4'>
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !formData.name.trim() || !formData.url?.trim()}
                  className='text-muted-foreground hover:text-foreground'
                >
                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                </Button>
                {testResult?.success && <span className='text-green-600 text-xs'>✓ Connected</span>}
              </div>
              {testResult && !testResult.success && (
                <div className='rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-600 text-xs dark:border-red-800 dark:bg-red-950/20'>
                  <div className='font-medium'>Connection failed</div>
                  <div className='text-red-500 dark:text-red-400'>
                    {testResult.error || testResult.message}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => {
              resetForm()
              onOpenChange(false)
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !formData.name.trim() || !formData.url?.trim()}
          >
            {isLoading ? 'Adding...' : 'Add Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
