import { Badge } from '@/components/ui/badge'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WEBHOOK_PROVIDERS } from '../../webhook-config'

interface WebhookDialogHeaderProps {
  webhookProvider: string
  webhookId: string | undefined
}

export function WebhookDialogHeader({ webhookProvider, webhookId }: WebhookDialogHeaderProps) {
  const provider = WEBHOOK_PROVIDERS[webhookProvider] || WEBHOOK_PROVIDERS.generic

  // Get provider icon
  const getProviderIcon = () => {
    return provider.icon({
      className:
        webhookProvider === 'github' ? 'h-5 w-5' : 'h-5 w-5 text-green-500 dark:text-green-400',
    })
  }

  // Get provider-specific title
  const getProviderTitle = () => {
    return `${provider.name} Integration`
  }

  return (
    <DialogHeader className="flex flex-row items-center justify-between">
      <div className="flex items-center">
        <div className="mr-3 flex items-center">{getProviderIcon()}</div>
        <div>
          <DialogTitle>{getProviderTitle()}</DialogTitle>
          <DialogDescription>
            {webhookProvider === 'generic'
              ? 'Configure your webhook integration'
              : `Configure your ${provider.name.toLowerCase()} integration`}
          </DialogDescription>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        {webhookId && (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
          >
            Connected
          </Badge>
        )}
      </div>
    </DialogHeader>
  )
}
