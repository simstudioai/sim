import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Notice, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'

const logger = createLogger('CopilotSettings')

interface CopilotKey {
  id: string
  apiKey: string
}

export function Copilot() {
  const [keys, setKeys] = useState<CopilotKey[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const hasKeys = keys.length > 0

  const maskedValue = useCallback((value: string, show: boolean) => {
    if (show) return value
    if (!value) return ''
    const last4 = value.slice(-4)
    return `***-***-${last4}`
  }, [])

  const fetchKeys = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/copilot/api-keys')
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      const data = await res.json()
      setKeys(Array.isArray(data.keys) ? data.keys : [])
    } catch (error) {
      logger.error('Failed to fetch copilot keys', { error })
      setKeys([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const onGenerate = async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/copilot/api-keys/generate', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to generate API key')
      }
      await fetchKeys()
    } catch (error) {
      logger.error('Failed to generate copilot API key', { error })
    } finally {
      setIsLoading(false)
    }
  }

  const onDelete = async (id: string) => {
    try {
      setIsLoading(true)
      const res = await fetch(`/api/copilot/api-keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to delete API key')
      }
      await fetchKeys()
    } catch (error) {
      logger.error('Failed to delete copilot API key', { error })
    } finally {
      setIsLoading(false)
    }
  }

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch (error) {
      logger.error('Copy failed', { error })
    }
  }

  return (
    <div className='space-y-6 p-6'>
      <h2 className='mb-[22px] font-medium text-lg'>Copilot</h2>

      {hasKeys ? (
        <Notice variant='success'>You have {keys.length} Copilot API key{keys.length > 1 ? 's' : ''}.</Notice>
      ) : (
        <Notice variant='warning'>No Copilot API keys yet. Generate one to use Copilot programmatically.</Notice>
      )}

      <div className='flex items-center gap-3'>
        <Button onClick={onGenerate} disabled={isLoading}>
          <Plus className='mr-2 h-4 w-4' /> Generate API Key
        </Button>
      </div>

      {hasKeys && (
        <div className='space-y-3'>
          {keys.map((k) => {
            const isVisible = !!visible[k.id]
            const value = maskedValue(k.apiKey, isVisible)
            return (
              <div key={k.id} className='flex items-center gap-3'>
                <Input value={value} readOnly type='text' className='font-mono' />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant='secondary' onClick={() => setVisible((v) => ({ ...v, [k.id]: !isVisible }))}>
                        {isVisible ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{isVisible ? 'Hide' : 'View'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant='secondary' onClick={() => onCopy(k.apiKey)}>
                        <Copy className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant='destructive' onClick={() => onDelete(k.id)} disabled={isLoading}>
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
} 