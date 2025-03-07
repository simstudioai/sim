import { useState } from 'react'
import { useParams } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WebhookModal } from '@/components/ui/webhook-modal'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface WebhookConfigProps {
  blockId: string
  subBlockId?: string
  isConnecting: boolean
}

export function WebhookConfig({ blockId, subBlockId, isConnecting }: WebhookConfigProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const params = useParams()
  const workflowId = params.id as string

  // Get the webhook provider from the block state
  const [webhookProvider] = useSubBlockValue(blockId, 'webhookProvider')

  // Generate a default path based on the workflow ID if none exists
  const defaultPath = `/${workflowId.substring(0, 8)}`
  // Use the default path if no path is set
  const [webhookPath, setWebhookPath] = useSubBlockValue(blockId, 'webhookPath')

  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleSaveWebhook = async (path: string, secret: string) => {
    try {
      // Set the webhook path in the block state
      if (path && path !== webhookPath) {
        setWebhookPath(path)
      }

      // Here you would typically save the webhook to your database
      // This is a placeholder for the actual API call
      await saveWebhookToDatabase(workflowId, path, webhookProvider || 'generic')

      return true
    } catch (error) {
      console.error('Error saving webhook:', error)
      return false
    }
  }

  // This function would be replaced with your actual API call
  const saveWebhookToDatabase = async (workflowId: string, path: string, provider: string) => {
    // Simulate an API call
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('Webhook saved:', { workflowId, path, provider })
        resolve(true)
      }, 500)
    })
  }

  return (
    <div className="mt-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleOpenModal}
        disabled={isConnecting}
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        View Webhook URL
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
