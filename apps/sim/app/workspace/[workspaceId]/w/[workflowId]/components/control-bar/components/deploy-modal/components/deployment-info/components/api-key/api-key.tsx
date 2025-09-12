'use client'

import { Label } from '@/components/ui/label'

interface ApiKeyProps {
  apiKey: string
  showLabel?: boolean
}

export function ApiKey({ apiKey, showLabel = true }: ApiKeyProps) {
  // Extract key name and type from the API response format "Name (type)"
  const getKeyInfo = (keyInfo: string) => {
    if (!keyInfo || keyInfo.includes('No API key found')) {
      return { name: keyInfo, type: null }
    }

    const match = keyInfo.match(/^(.*?)\s+\(([^)]+)\)$/)
    if (match) {
      return { name: match[1].trim(), type: match[2] }
    }

    return { name: keyInfo, type: null }
  }

  const { name, type } = getKeyInfo(apiKey)

  return (
    <div className='space-y-1.5'>
      {showLabel && (
        <div className='flex items-center gap-1.5'>
          <Label className='font-medium text-sm'>API Key</Label>
        </div>
      )}
      <div className='rounded-md border bg-background'>
        <div className='flex items-center justify-between p-3'>
          <pre className='flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs'>{name}</pre>
          {type && (
            <div className='ml-2 flex-shrink-0'>
              <span className='inline-flex items-center rounded-md bg-muted px-2 py-1 font-medium text-muted-foreground text-xs capitalize'>
                {type}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
