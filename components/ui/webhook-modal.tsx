import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { GithubIcon, StripeIcon, WhatsAppIcon } from '@/components/icons'
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

interface WebhookModalProps {
  isOpen: boolean
  onClose: () => void
  webhookPath: string
  webhookProvider: string
  workflowId: string
  onSave?: (path: string, providerConfig: ProviderConfig) => void
}

export function WebhookModal({
  isOpen,
  onClose,
  webhookPath,
  webhookProvider,
  workflowId,
  onSave,
}: WebhookModalProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Provider-specific configuration state
  const [whatsappVerificationToken, setWhatsappVerificationToken] = useState('')
  const [githubContentType, setGithubContentType] = useState('application/json')

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

  const getProviderConfig = (): ProviderConfig => {
    switch (webhookProvider) {
      case 'whatsapp':
        return { verificationToken: whatsappVerificationToken }
      case 'github':
        return { contentType: githubContentType }
      case 'stripe':
        return {}
      default:
        return {}
    }
  }

  const handleSave = async () => {
    if (onSave) {
      setSaving(true)
      try {
        const providerConfig = getProviderConfig()
        await onSave(webhookPath || formattedPath.substring(1), providerConfig)
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

  // Get provider icon
  const getProviderIcon = () => {
    switch (webhookProvider) {
      case 'whatsapp':
        return <WhatsAppIcon className="h-6 w-6 text-green-500" />
      case 'github':
        return <GithubIcon className="h-6 w-6" />
      case 'stripe':
        return <StripeIcon className="h-6 w-6 text-purple-500" />
      default:
        return null
    }
  }

  // Provider-specific setup instructions and configuration fields
  const renderProviderContent = () => {
    switch (webhookProvider) {
      case 'whatsapp':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp-verification-token">Verification Token</Label>
              <Input
                id="whatsapp-verification-token"
                value={whatsappVerificationToken}
                onChange={(e) => setWhatsappVerificationToken(e.target.value)}
                placeholder="Enter a verification token for WhatsApp"
                className="flex-1"
              />
              <p className="text-xs text-muted-foreground">
                This token will be used to verify your webhook with WhatsApp.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Setup Instructions</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Go to your Meta for Developers dashboard</li>
                <li>Navigate to your WhatsApp app settings</li>
                <li>Under "Webhooks", click "Configure"</li>
                <li>Enter the Webhook URL shown above</li>
                <li>Enter the verification token you specified above</li>
                <li>Subscribe to the "messages" webhook field</li>
                <li>Save your changes</li>
              </ol>
            </div>
          </div>
        )
      case 'github':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="github-content-type">Content Type</Label>
              <Input
                id="github-content-type"
                value={githubContentType}
                onChange={(e) => setGithubContentType(e.target.value)}
                placeholder="application/json"
                className="flex-1"
              />
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Setup Instructions</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Go to your GitHub repository</li>
                <li>Navigate to Settings {'>'} Webhooks</li>
                <li>Click "Add webhook"</li>
                <li>Enter the Webhook URL shown above</li>
                <li>Set Content type to "{githubContentType}"</li>
                <li>Choose which events you want to trigger the webhook</li>
                <li>Ensure "Active" is checked and save</li>
              </ol>
            </div>
          </div>
        )
      case 'stripe':
        return (
          <div className="space-y-2">
            <h4 className="font-medium">Setup Instructions</h4>
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
        <DialogHeader className="flex flex-row items-center gap-2">
          {getProviderIcon()}
          <div>
            <DialogTitle>Webhook Configuration</DialogTitle>
            <DialogDescription>
              Configure your{' '}
              {webhookProvider === 'whatsapp'
                ? 'WhatsApp'
                : webhookProvider === 'github'
                  ? 'GitHub'
                  : webhookProvider === 'stripe'
                    ? 'Stripe'
                    : 'webhook'}{' '}
              integration
            </DialogDescription>
          </div>
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

          {/* Provider-specific instructions and configuration */}
          <div className="space-y-2 pt-2 border-t">{renderProviderContent()}</div>
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
