import { useEffect, useState } from 'react'
import { Check, Copy, Loader2, Trash2, X } from 'lucide-react'
import { GithubIcon, StripeIcon, WhatsAppIcon } from '@/components/icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
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
  onDelete?: () => void
  webhookId?: string
}

export function WebhookModal({
  isOpen,
  onClose,
  webhookPath,
  webhookProvider,
  workflowId,
  onSave,
  onDelete,
  webhookId,
}: WebhookModalProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const isConfigured = Boolean(webhookId)

  // Provider-specific configuration state
  const [whatsappVerificationToken, setWhatsappVerificationToken] = useState('')
  const [githubContentType, setGithubContentType] = useState('application/json')

  // Load existing configuration values
  useEffect(() => {
    if (webhookId) {
      // If we have a webhook ID, try to fetch the existing configuration
      const fetchWebhookConfig = async () => {
        try {
          const response = await fetch(`/api/webhooks/${webhookId}`)
          if (response.ok) {
            const data = await response.json()
            if (data.webhook?.webhook?.providerConfig) {
              const config = data.webhook.webhook.providerConfig

              // Check provider type and set appropriate state
              if (webhookProvider === 'whatsapp' && 'verificationToken' in config) {
                setWhatsappVerificationToken(config.verificationToken)
              } else if (webhookProvider === 'github' && 'contentType' in config) {
                setGithubContentType(config.contentType)
              }
            }
          }
        } catch (error) {
          console.error('Error fetching webhook config:', error)
        }
      }

      fetchWebhookConfig()
    }
  }, [webhookId, webhookProvider])

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
    setIsSaving(true)
    try {
      // Call the onSave callback with the path and provider-specific config
      if (onSave) {
        const providerConfig = getProviderConfig()
        // Use the path without the leading slash
        const pathToSave = formattedPath.startsWith('/')
          ? formattedPath.substring(1)
          : formattedPath
        await onSave(pathToSave, providerConfig)
      }
    } catch (error) {
      console.error('Error saving webhook:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      if (onDelete) {
        await onDelete()
        setShowDeleteConfirm(false)
      }
    } catch (error) {
      console.error('Error deleting webhook:', error)
    } finally {
      setIsDeleting(false)
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
              <ol className="space-y-2">
                <li className="flex items-start">
                  <span className="text-gray-500 mr-2">1.</span>
                  <span className="text-sm">Go to WhatsApp Business Platform dashboard</span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 mr-2">2.</span>
                  <span className="text-sm">Navigate to "Configuration" in the sidebar</span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 mr-2">3.</span>
                  <span className="text-sm">Enter the URL above as "Callback URL"</span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 mr-2">4.</span>
                  <span className="text-sm">Enter your token as "Verify token"</span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 mr-2">5.</span>
                  <span className="text-sm">
                    Click "Verify and save" and subscribe to "messages"
                  </span>
                </li>
              </ol>
              <div className="bg-blue-50 p-3 rounded-md mt-3">
                <h5 className="text-sm font-medium text-blue-800">Requirements</h5>
                <ul className="mt-1 space-y-1">
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    <span className="text-sm text-blue-700">
                      URL must be publicly accessible with HTTPS
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    <span className="text-sm text-blue-700">
                      Self-signed SSL certificates not supported
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    <span className="text-sm text-blue-700">
                      For local testing, use ngrok to expose your server
                    </span>
                  </li>
                </ul>
              </div>
              <div className="bg-gray-50 p-3 rounded-md mt-3">
                <p className="text-sm text-gray-700 flex items-center">
                  <span className="text-gray-400 mr-2">💡</span>
                  After saving, use "Test" to verify your webhook connection.
                </p>
              </div>
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
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-start">
            <div className="mr-3">{getProviderIcon()}</div>
            <div>
              <DialogTitle>Webhook Configuration</DialogTitle>
              <DialogDescription>Configure your WhatsApp integration</DialogDescription>
            </div>
            {webhookId && (
              <Badge
                variant="outline"
                className="ml-auto bg-green-50 text-green-700 border-green-200"
              >
                Connected
              </Badge>
            )}
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <div className="flex items-center space-x-2">
                <Input id="webhook-url" value={webhookUrl} readOnly className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(webhookUrl, 'url')}
                >
                  {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {renderProviderContent()}
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-y-0 space-y-2 gap-2 mt-4">
            {webhookId && (
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:mr-auto">
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                  className="w-full sm:w-auto"
                  size="sm"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-3 w-3" />
                      Delete
                    </>
                  )}
                </Button>
                {webhookProvider === 'whatsapp' && (
                  <Button
                    variant="outline"
                    onClick={() => window.open(`/webhooks/test/${webhookId}`, '_blank')}
                    className="w-full sm:w-auto"
                    size="sm"
                  >
                    Test
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button variant="outline" onClick={onClose} className="w-full sm:w-auto" size="sm">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full sm:w-auto"
                size="sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the webhook configuration. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
