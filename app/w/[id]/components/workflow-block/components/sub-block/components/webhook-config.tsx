import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, ExternalLink } from 'lucide-react'
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
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [webhookId, setWebhookId] = useState<string | null>(null)
  const params = useParams()
  const workflowId = params.id as string

  // Get the webhook provider from the block state
  const [webhookProvider] = useSubBlockValue(blockId, 'webhookProvider')

  // Store the webhook path
  const [webhookPath, setWebhookPath] = useSubBlockValue(blockId, 'webhookPath')

  // Store provider-specific configuration
  const [providerConfig, setProviderConfig] = useSubBlockValue(blockId, 'providerConfig')

  // Check if webhook exists in the database
  useEffect(() => {
    const checkWebhook = async () => {
      try {
        // Check if there's a webhook for this workflow
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook
            setWebhookId(webhook.id)

            // Update the path in the block state if it's different
            if (webhook.path && webhook.path !== webhookPath) {
              setWebhookPath(webhook.path)
            }
          } else {
            setWebhookId(null)
          }
        }
      } catch (error) {
        console.error('Error checking webhook:', error)
      }
    }

    checkWebhook()
  }, [webhookPath, workflowId, setWebhookPath])

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

      const data = await response.json()
      setWebhookId(data.webhook.id)

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

  const handleDeleteWebhook = async () => {
    if (!webhookId) return

    try {
      setIsDeleting(true)
      setError(null)

      const response = await fetch(`/api/webhooks/${webhookId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete webhook')
      }

      // Clear the webhook ID
      setWebhookId(null)

      console.log('Webhook deleted successfully')
      return true
    } catch (error: any) {
      console.error('Error deleting webhook:', error)
      setError(error.message || 'Failed to delete webhook')
      return false
    } finally {
      setIsDeleting(false)
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
        disabled={isConnecting || isSaving || isDeleting}
      >
        {webhookId ? (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
            {isSaving ? 'Saving...' : isDeleting ? 'Deleting...' : 'Webhook Connected'}
          </>
        ) : (
          <>
            <ExternalLink className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : isDeleting ? 'Deleting...' : 'Configure Webhook'}
          </>
        )}
      </Button>

      {isModalOpen && (
        <WebhookModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          webhookPath={webhookPath || ''}
          webhookProvider={webhookProvider || 'generic'}
          workflowId={workflowId}
          onSave={handleSaveWebhook}
          onDelete={handleDeleteWebhook}
          webhookId={webhookId || undefined}
        />
      )}
    </div>
  )
}
