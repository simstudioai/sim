'use client'

import { useCallback, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useMcpServersStore } from '@/stores/mcp-servers/store'

const logger = createLogger('McpServerModal')

interface McpServerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onServerCreated?: () => void
}

interface McpServerFormData {
  name: string
  transport: 'http' | 'sse'
  url?: string
  headers?: Record<string, string>
}

export function McpServerModal({ open, onOpenChange, onServerCreated }: McpServerModalProps) {
  const [formData, setFormData] = useState<McpServerFormData>({
    name: '',
    transport: 'http',
    url: '',
    headers: {},
  })
  const { createServer, isLoading, error: storeError, clearError } = useMcpServersStore()
  const [localError, setLocalError] = useState<string | null>(null)

  const error = localError || storeError

  const resetForm = () => {
    setFormData({
      name: '',
      transport: 'http',
      url: '',
      headers: {},
    })
    setLocalError(null)
    clearError()
  }

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
      await createServer({
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url,
        timeout: 30000,
        headers: formData.headers,
        enabled: true,
      })

      logger.info(`Added MCP server: ${formData.name}`)
      resetForm()
      onOpenChange(false)
      onServerCreated?.()
    } catch (error) {
      logger.error('Failed to add MCP server:', error)
      setLocalError(error instanceof Error ? error.message : 'Failed to add MCP server')
    }
  }, [formData, onOpenChange, onServerCreated, createServer, clearError])

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
                  setFormData((prev) => ({
                    ...prev,
                    transport: value,
                  }))
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
                    placeholder='Header name'
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
                    placeholder='Header value'
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

          {error && (
            <div className='rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm'>
              {error}
            </div>
          )}
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
          <Button onClick={handleSubmit} disabled={isLoading || !formData.name.trim()}>
            {isLoading ? 'Adding...' : 'Add Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
