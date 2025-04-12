import { useState } from 'react'
import { CheckCheck, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface WebhookUrlFieldProps {
  webhookUrl: string
  isLoadingToken: boolean
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
}

export function WebhookUrlField({
  webhookUrl,
  isLoadingToken,
  copied,
  copyToClipboard,
}: WebhookUrlFieldProps) {
  return (
    <div className="space-y-1 mb-4">
      <Label htmlFor="webhook-url" className="text-sm font-medium">
        Webhook URL
      </Label>
      <div className="flex">
        <Input
          id="webhook-url"
          readOnly
          value={webhookUrl}
          className="flex-1 h-10 font-mono text-xs cursor-text"
          onClick={(e) => (e.target as HTMLInputElement).select()}
          disabled={isLoadingToken}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="ml-2 h-10 w-10"
          onClick={() => copyToClipboard(webhookUrl, 'url')}
          disabled={isLoadingToken}
        >
          {copied === 'url' ? (
            <CheckCheck className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        This is the URL that will receive webhook requests
      </p>
    </div>
  )
}
