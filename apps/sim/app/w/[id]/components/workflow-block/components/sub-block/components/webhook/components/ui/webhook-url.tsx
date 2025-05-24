import { CheckCheck, Copy, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

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
      <div className="flex items-center gap-2">
        <Label htmlFor="webhook-url" className="text-sm font-medium">
          Webhook URL
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-500 p-1 h-6 w-6"
              aria-label="Learn more about webhook URL"
            >
              <Info className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="center"
            className="max-w-[300px] p-3 z-[100]"
            role="tooltip"
          >
            <p className="text-sm">URL that will receive webhook requests</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex">
        <Input
          id="webhook-url"
          readOnly
          value={webhookUrl}
          className={cn(
            'flex-1 h-10 font-mono text-xs cursor-text',
            'focus-visible:ring-2 focus-visible:ring-primary/20'
          )}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          disabled={isLoadingToken}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={cn('ml-2 h-10 w-10', 'hover:bg-primary/5', 'transition-colors')}
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
    </div>
  )
}
