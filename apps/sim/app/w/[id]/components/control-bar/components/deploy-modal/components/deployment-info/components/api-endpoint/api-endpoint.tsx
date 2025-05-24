'use client'

import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'

interface ApiEndpointProps {
  endpoint: string
  showLabel?: boolean
}

export function ApiEndpoint({ endpoint, showLabel = true }: ApiEndpointProps) {
  return (
    <div className='space-y-1.5'>
      {showLabel && (
        <div className='flex items-center gap-1.5'>
          <Label className='font-medium text-sm'>API Endpoint</Label>
        </div>
      )}
      <div className='group relative rounded-md border bg-background transition-colors hover:bg-muted/50'>
        <pre className='overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs'>{endpoint}</pre>
        <CopyButton text={endpoint} />
      </div>
    </div>
  )
}
