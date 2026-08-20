'use client'

import { useState } from 'react'
import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'

interface ApiKeyProps {
  apiKey: string
  showLabel?: boolean
}

export function ApiKey({ apiKey, showLabel = true }: ApiKeyProps) {
  const [showKey, setShowKey] = useState(false)

  // Function to mask API key with asterisks but keep first and last 4 chars visible
  const maskApiKey = (key: string) => {
    if (!key || key.includes('No API key found')) return key
    if (key.length <= 8) return key
    return `${key.substring(0, 4)}${'*'.repeat(key.length - 8)}${key.substring(key.length - 4)}`
  }

  return (
    <div className='space-y-1.5'>
      {showLabel && (
        <div className='flex items-center gap-1.5'>
          <Label className='font-medium text-sm'>API Key</Label>
        </div>
      )}
      <div className='group relative rounded-md border bg-background transition-colors hover:bg-muted/50'>
        <pre
          className='cursor-pointer overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs'
          onClick={() => setShowKey(!showKey)}
          title={showKey ? 'Click to hide API Key' : 'Click to reveal API Key'}
        >
          {showKey ? apiKey : maskApiKey(apiKey)}
        </pre>
        <CopyButton text={apiKey} />
      </div>
    </div>
  )
}
