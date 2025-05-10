'use client'

import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'

interface ApiEndpointProps {
  endpoint: string
  showLabel?: boolean
}

export function ApiEndpoint({ endpoint, showLabel = true }: ApiEndpointProps) {
  return (
    <div className="space-y-1.5">
      {showLabel && (
        <div className="flex items-center gap-1.5">
          <Label className="font-medium text-sm">API Endpoint</Label>
        </div>
      )}
      <div className="relative group rounded-md border bg-background hover:bg-muted/50 transition-colors">
        <pre className="p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto">{endpoint}</pre>
        <CopyButton text={endpoint} />
      </div>
    </div>
  )
}
