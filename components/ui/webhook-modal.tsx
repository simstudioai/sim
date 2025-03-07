import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface WebhookModalProps {
  isOpen: boolean
  onClose: () => void
  webhookPath: string
  webhookProvider: string
  webhookSecret?: string
  workflowId: string
  onSave?: (path: string, secret: string) => void
}

export function WebhookModal({
  isOpen,
  onClose,
  webhookPath,
  webhookProvider,
  webhookSecret,
  workflowId,
  onSave,
}: WebhookModalProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Format the path to ensure it starts with a slash
  const formattedPath =
    webhookPath && webhookPath.trim() !== ''
      ? webhookPath.startsWith('/')
        ? webhookPath
        : `/${webhookPath}`
      : `/${workflowId.substring(0, 8)}`

  // Construct the full webhook URL
  const baseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'https://your-domain.com'

  const webhookUrl = `${baseUrl}/api/webhooks/trigger${formattedPath}`

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSave = async () => {
    if (onSave) {
      setSaving(true)
      try {
        // We're keeping the existing path and secret
        await onSave(webhookPath || formattedPath.substring(1), webhookSecret || '')
        onClose()
      } catch (error) {
        console.error('Error saving webhook configuration:', error)
      } finally {
        setSaving(false)
      }
    } else {
      onClose()
    }
  }

  // Provider-specific setup instructions
  const getProviderInstructions = () => {
    switch (webhookProvider) {
      case 'whatsapp':
        return (
          <div className="space-y-2">
            <h4 className="font-medium">WhatsApp Setup Instructions</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Go to your Meta for Developers dashboard</li>
              <li>Navigate to your WhatsApp app settings</li>
              <li>Under "Webhooks", click "Configure"</li>
              <li>Enter the Webhook URL shown above</li>
              <li>
                Enter your verification token (set in environment variables as{' '}
                <code>WHATSAPP_VERIFY_TOKEN</code>)
              </li>
              <li>Subscribe to the "messages" webhook field</li>
              <li>Save your changes</li>
            </ol>
            <p className="text-sm text-muted-foreground mt-2">
              Note: You'll need to set the WHATSAPP_VERIFY_TOKEN environment variable on your
              server.
            </p>
          </div>
        )
      case 'github':
        return (
          <div className="space-y-2">
            <h4 className="font-medium">GitHub Setup Instructions</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Go to your GitHub repository</li>
              <li>Navigate to Settings {'>'} Webhooks</li>
              <li>Click "Add webhook"</li>
              <li>Enter the Webhook URL shown above</li>
              <li>Set Content type to "application/json"</li>
              <li>Choose which events you want to trigger the webhook</li>
              <li>Ensure "Active" is checked and save</li>
            </ol>
          </div>
        )
      case 'stripe':
        return (
          <div className="space-y-2">
            <h4 className="font-medium">Stripe Setup Instructions</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Go to your Stripe Dashboard</li>
              <li>Navigate to Developers {'>'} Webhooks</li>
              <li>Click "Add endpoint"</li>
              <li>Enter the Webhook URL shown above</li>
              <li>Select the events you want to listen for</li>
              <li>Add the endpoint</li>
            </ol>
          </div>
        )
      default:
        return (
          <div className="space-y-2">
            <h4 className="font-medium">Generic Webhook Setup</h4>
            <p className="text-sm">Use the URL above to send webhook events to this workflow.</p>
          </div>
        )
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Webhook Configuration</DialogTitle>
          <DialogDescription>
            Use this information to configure your webhook integration
            {webhookProvider === 'whatsapp' && ' with whatsapp'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <div className="flex items-center space-x-2">
              <Input id="webhook-url" value={webhookUrl} readOnly className="flex-1" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(webhookUrl, 'url')}
                className="flex-shrink-0"
                title="Copy URL"
              >
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Provider-specific instructions */}
          <div className="space-y-2 pt-2 border-t">{getProviderInstructions()}</div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex space-x-2">
            <Button
              variant="secondary"
              onClick={() => window.open(`/api/webhooks/${workflowId}/test`, '_blank')}
            >
              Test Webhook
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
