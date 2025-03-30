import { Check, Copy, Loader2 } from 'lucide-react'
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
    <div className="space-y-2">
      <Label htmlFor="webhook-url">Webhook URL</Label>
      <div className="flex items-center space-x-2 pr-1">
        {isLoadingToken ? (
          <div className="flex-1 h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Input id="webhook-url" value={webhookUrl} readOnly className="flex-1" />
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => copyToClipboard(webhookUrl, 'url')}
          disabled={isLoadingToken}
          className="ml-1"
        >
          {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
