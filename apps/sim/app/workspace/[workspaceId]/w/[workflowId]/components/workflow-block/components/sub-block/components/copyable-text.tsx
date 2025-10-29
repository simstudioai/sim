import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useWebhookManagement } from '@/hooks/use-webhook-management'

interface CopyableTextProps {
  blockId: string
  subBlockId: string
  content: string
  placeholder?: string
  isPreview?: boolean
  useWebhookUrl?: boolean // If true, will use webhook URL from webhook management hook
  webhookTriggerId?: string // The trigger ID to use for webhook management
}

export function CopyableText({
  blockId,
  subBlockId,
  content,
  placeholder,
  isPreview = false,
  useWebhookUrl = false,
  webhookTriggerId,
}: CopyableTextProps) {
  const [copied, setCopied] = useState(false)

  // Use webhook management hook if this is displaying a webhook URL
  // Webhooks are per-block, not per-trigger, so we don't need trigger ID
  const { webhookUrl, isLoading } = useWebhookManagement({
    blockId,
    triggerId: webhookTriggerId, // Pass if provided (for backward compatibility)
    isPreview,
  })

  // Use webhook URL if requested, otherwise use provided content
  const displayContent = useWebhookUrl ? webhookUrl : content

  const handleCopy = () => {
    if (displayContent) {
      navigator.clipboard.writeText(displayContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Show loading state for webhook URLs
  if (useWebhookUrl && isLoading) {
    return (
      <div id={`${blockId}-${subBlockId}`} className='relative'>
        <Input
          value=''
          readOnly
          placeholder='Loading webhook URL...'
          className={cn(
            'h-9 cursor-text rounded-[8px] pr-10 font-mono text-xs',
            'focus-visible:ring-2 focus-visible:ring-primary/20',
            'text-muted-foreground'
          )}
        />
      </div>
    )
  }

  return (
    <div id={`${blockId}-${subBlockId}`} className='relative'>
      <Input
        value={displayContent || ''}
        readOnly
        placeholder={placeholder || 'No value available'}
        className={cn(
          'h-9 cursor-text rounded-[8px] pr-10 font-mono text-xs',
          'focus-visible:ring-2 focus-visible:ring-primary/20',
          !displayContent && 'text-muted-foreground'
        )}
        onClick={(e) => {
          if (displayContent) {
            ;(e.target as HTMLInputElement).select()
          }
        }}
      />
      {displayContent && (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className={cn(
            'absolute top-0.5 right-0.5 h-8 w-8 p-0',
            'text-muted-foreground/60 transition-all duration-200',
            'hover:scale-105 hover:bg-muted/50 hover:text-foreground',
            'active:scale-95'
          )}
          onClick={handleCopy}
        >
          {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
        </Button>
      )}
    </div>
  )
}
