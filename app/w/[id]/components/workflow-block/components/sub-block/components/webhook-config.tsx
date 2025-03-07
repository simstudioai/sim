import { useState } from 'react'
import { useParams } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WebhookModal } from '@/components/ui/webhook-modal'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

// Define provider-specific configuration types
interface WhatsAppConfig {
  verificationToken: string
}

interface GitHubConfig {
  contentType: string
}

interface StripeConfig {
  // Any Stripe-specific fields would go here
}

type ProviderConfig = WhatsAppConfig | GitHubConfig | StripeConfig | Record<string, never>

interface WebhookConfigProps {
  blockId: string
  subBlockId?: string
  isConnecting: boolean
}

export function WebhookConfig({ blockId, subBlockId, isConnecting }: WebhookConfigProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const params = useParams()
  const workflowId = params.id as string

  // Get the webhook provider from the block state
  const [webhookProvider] = useSubBlockValue(blockId, 'webhookProvider')

  // Generate a default path based on the workflow ID if none exists
  const defaultPath = `/${workflowId.substring(0, 8)}`
  // Use the default path if no path is set
  const [webhookPath, setWebhookPath] = useSubBlockValue(blockId, 'webhookPath')
  // Store provider-specific configuration
  const [providerConfig, setProviderConfig] = useSubBlockValue(blockId, 'providerConfig')

  const handleOpenModal = () => {
    setIsModalOpen(true)
    setError(null)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleSaveWebhook = async (path: string, config: ProviderConfig) => {
    try {
      setIsSaving(true)
      setError(null)

      // Set the webhook path in the block state
      if (path && path !== webhookPath) {
        setWebhookPath(path)
      }

      // Set the provider config in the block state
      setProviderConfig(config)

      // Save the webhook to the database
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          path,
          provider: webhookProvider || 'generic',
          providerConfig: config,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save webhook')
      }

      console.log('Webhook configuration saved successfully')
      return true
    } catch (error: any) {
      console.error('Error saving webhook:', error)
      setError(error.message || 'Failed to save webhook configuration')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mt-2">
      {error && <div className="text-sm text-red-500 mb-2">{error}</div>}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleOpenModal}
        disabled={isConnecting || isSaving}
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        {isSaving ? 'Saving...' : 'View Webhook URL'}
      </Button>

      {isModalOpen && (
        <WebhookModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          webhookPath={webhookPath || defaultPath}
          webhookProvider={webhookProvider || 'generic'}
          workflowId={workflowId}
          onSave={handleSaveWebhook}
        />
      )}
    </div>
  )
}
