import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Loader2, Trash2 } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
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
import { createLogger } from '@/lib/logs/console-logger'
import { ProviderConfig, WEBHOOK_PROVIDERS } from '../webhook-config'

const logger = createLogger('WebhookModal')

interface WebhookModalProps {
  isOpen: boolean
  onClose: () => void
  webhookPath: string
  webhookProvider: string
  workflowId: string
  onSave?: (path: string, providerConfig: ProviderConfig) => Promise<boolean>
  onDelete?: () => Promise<boolean>
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
  const [isTesting, setIsTesting] = useState(false)
  const [isLoadingToken, setIsLoadingToken] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message?: string
    test?: {
      curlCommand?: string
      status?: number
      contentType?: string
      responseText?: string
      headers?: Record<string, string>
      samplePayload?: Record<string, any>
    }
  } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] = useState(false)
  const isConfigured = Boolean(webhookId)

  // Provider-specific configuration state
  const [whatsappVerificationToken, setWhatsappVerificationToken] = useState('')
  const [githubContentType, setGithubContentType] = useState('application/json')

  // General webhook configuration state
  const [generalToken, setGeneralToken] = useState('')
  const [secretHeaderName, setSecretHeaderName] = useState('')
  const [requireAuth, setRequireAuth] = useState(false)
  const [allowedIps, setAllowedIps] = useState('')

  // Original values to track changes
  const [originalValues, setOriginalValues] = useState({
    whatsappVerificationToken: '',
    githubContentType: 'application/json',
    generalToken: '',
    secretHeaderName: '',
    requireAuth: false,
    allowedIps: '',
  })

  // Get the current provider configuration
  const provider = WEBHOOK_PROVIDERS[webhookProvider] || WEBHOOK_PROVIDERS.generic

  // Generate a random verification token if none exists
  useEffect(() => {
    if (
      webhookProvider === 'whatsapp' &&
      !whatsappVerificationToken &&
      !webhookId &&
      !isLoadingToken
    ) {
      const randomToken = Math.random().toString(36).substring(2, 10)
      setWhatsappVerificationToken(randomToken)
      setOriginalValues((prev) => ({ ...prev, whatsappVerificationToken: randomToken }))
    }

    // Generate a random token for general webhook if none exists and auth is required
    if (
      webhookProvider === 'generic' &&
      !generalToken &&
      !webhookId &&
      !isLoadingToken &&
      requireAuth
    ) {
      const randomToken = crypto.randomUUID()
      setGeneralToken(randomToken)
      setOriginalValues((prev) => ({ ...prev, generalToken: randomToken }))
    }
  }, [
    webhookProvider,
    whatsappVerificationToken,
    generalToken,
    webhookId,
    isLoadingToken,
    requireAuth,
  ])

  // Load existing configuration values
  useEffect(() => {
    if (webhookId) {
      // If we have a webhook ID, try to fetch the existing configuration
      const fetchWebhookConfig = async () => {
        try {
          setIsLoadingToken(true)
          const response = await fetch(`/api/webhooks/${webhookId}`)
          if (response.ok) {
            const data = await response.json()
            if (data.webhook?.webhook?.providerConfig) {
              const config = data.webhook.webhook.providerConfig

              // Check provider type and set appropriate state
              if (webhookProvider === 'whatsapp' && 'verificationToken' in config) {
                const token = config.verificationToken || ''
                setWhatsappVerificationToken(token)
                setOriginalValues((prev) => ({ ...prev, whatsappVerificationToken: token }))
              } else if (webhookProvider === 'github' && 'contentType' in config) {
                const contentType = config.contentType || 'application/json'
                setGithubContentType(contentType)
                setOriginalValues((prev) => ({ ...prev, githubContentType: contentType }))
              } else if (webhookProvider === 'generic') {
                // Set general webhook configuration
                const token = config.token || ''
                const headerName = config.secretHeaderName || ''
                const auth = !!config.requireAuth
                const ips = Array.isArray(config.allowedIps)
                  ? config.allowedIps.join(', ')
                  : config.allowedIps || ''

                setGeneralToken(token)
                setSecretHeaderName(headerName)
                setRequireAuth(auth)
                setAllowedIps(ips)

                setOriginalValues((prev) => ({
                  ...prev,
                  generalToken: token,
                  secretHeaderName: headerName,
                  requireAuth: auth,
                  allowedIps: ips,
                }))
              }
            }
          }
        } catch (error) {
          logger.error('Error fetching webhook config:', { error })
        } finally {
          setIsLoadingToken(false)
        }
      }

      fetchWebhookConfig()
    } else {
      // If we don't have a webhook ID, we're creating a new one
      // Reset the loading state
      setIsLoadingToken(false)
    }
  }, [webhookId, webhookProvider])

  // Check for unsaved changes
  useEffect(() => {
    // Compare current values with original values
    if (webhookProvider === 'whatsapp') {
      setHasUnsavedChanges(whatsappVerificationToken !== originalValues.whatsappVerificationToken)
    } else if (webhookProvider === 'github') {
      setHasUnsavedChanges(githubContentType !== originalValues.githubContentType)
    } else if (webhookProvider === 'generic') {
      setHasUnsavedChanges(
        generalToken !== originalValues.generalToken ||
          secretHeaderName !== originalValues.secretHeaderName ||
          requireAuth !== originalValues.requireAuth ||
          allowedIps !== originalValues.allowedIps
      )
    }
  }, [
    webhookProvider,
    whatsappVerificationToken,
    githubContentType,
    generalToken,
    secretHeaderName,
    requireAuth,
    allowedIps,
    originalValues,
  ])

  // Use the provided path or generate a UUID-based path
  const formattedPath = webhookPath && webhookPath.trim() !== '' ? webhookPath : crypto.randomUUID()

  // Construct the full webhook URL
  const baseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'https://your-domain.com'

  const webhookUrl = `${baseUrl}/api/webhooks/trigger/${formattedPath}`

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
      case 'generic':
        // Parse the allowed IPs into an array
        const parsedIps = allowedIps
          ? allowedIps
              .split(',')
              .map((ip) => ip.trim())
              .filter((ip) => ip)
          : []

        return {
          token: generalToken || undefined,
          secretHeaderName: secretHeaderName || undefined,
          requireAuth,
          allowedIps: parsedIps.length > 0 ? parsedIps : undefined,
        }
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
        // Always save the path without the leading slash to match how it's queried in the API
        const pathToSave = formattedPath.startsWith('/')
          ? formattedPath.substring(1)
          : formattedPath

        await new Promise((resolve) => setTimeout(resolve, 100))
        await onSave(pathToSave, providerConfig)
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Update original values to match current values after successful save
        setOriginalValues({
          whatsappVerificationToken,
          githubContentType,
          generalToken,
          secretHeaderName,
          requireAuth,
          allowedIps,
        })
        setHasUnsavedChanges(false)
      }
    } catch (error) {
      logger.error('Error saving webhook:', { error })
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
      logger.error('Error deleting webhook:', { error })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedChangesConfirm(true)
    } else {
      onClose()
    }
  }

  const handleCancelClose = () => {
    setShowUnsavedChangesConfirm(false)
  }

  const handleConfirmClose = () => {
    setShowUnsavedChangesConfirm(false)
    onClose()
  }

  // Test the webhook configuration
  const testWebhook = async () => {
    if (!webhookId) return

    try {
      setIsTesting(true)
      setTestResult(null)

      // Use the consolidated test endpoint
      const testEndpoint = `/api/webhooks/test?id=${webhookId}`

      const response = await fetch(testEndpoint)
      if (!response.ok) {
        throw new Error('Failed to test webhook')
      }

      const data = await response.json()

      // Add a slight delay before showing the result for smoother animation
      await new Promise((resolve) => setTimeout(resolve, 300))

      // If the test was successful, show a success message
      if (data.success) {
        setTestResult({
          success: true,
          message: data.message || 'Webhook configuration is valid.',
          test: data.test,
        })
      } else {
        setTestResult({
          success: false,
          message: data.message || data.error || 'Failed to validate webhook configuration',
        })
      }
    } catch (error: any) {
      logger.error('Error testing webhook:', { error })
      setTestResult({
        success: false,
        message: error.message || 'An error occurred while testing the webhook',
      })
    } finally {
      setIsTesting(false)
    }
  }

  // Get provider icon
  const getProviderIcon = () => {
    return provider.icon({
      className: 'h-5 w-5 text-green-500 dark:text-green-400',
    })
  }

  // Get provider-specific title
  const getProviderTitle = () => {
    return `${provider.name} Integration`
  }

  // Provider-specific setup instructions and configuration fields
  const renderProviderContent = () => {
    switch (webhookProvider) {
      case 'whatsapp':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp-verification-token">Verification Token</Label>
              <div className="flex items-center space-x-2">
                {isLoadingToken ? (
                  <div className="flex-1 h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Input
                    id="whatsapp-verification-token"
                    value={whatsappVerificationToken}
                    onChange={(e) => setWhatsappVerificationToken(e.target.value)}
                    placeholder="Enter a verification token for WhatsApp"
                    className="flex-1"
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(whatsappVerificationToken, 'token')}
                  disabled={isLoadingToken}
                >
                  {copied === 'token' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This token will be used to verify your webhook with WhatsApp.
              </p>
            </div>

            {testResult && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`p-3 rounded-md ${
                  testResult.success
                    ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                <p className="text-sm">{testResult.message}</p>
              </motion.div>
            )}

            <div className="space-y-2">
              <h4 className="font-medium">Setup Instructions</h4>
              <ol className="space-y-2">
                <li className="flex items-start">
                  <span className="text-gray-500 dark:text-gray-400 mr-2">1.</span>
                  <span className="text-sm">Go to WhatsApp Business Platform dashboard</span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 dark:text-gray-400 mr-2">2.</span>
                  <span className="text-sm">Navigate to "Configuration" in the sidebar</span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 dark:text-gray-400 mr-2">3.</span>
                  <span className="text-sm">
                    Enter the URL above as "Callback URL" (exactly as shown)
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 dark:text-gray-400 mr-2">4.</span>
                  <span className="text-sm">Enter your token as "Verify token"</span>
                </li>
                <li className="flex items-start">
                  <span className="text-gray-500 dark:text-gray-400 mr-2">5.</span>
                  <span className="text-sm">
                    Click "Verify and save" and subscribe to "messages"
                  </span>
                </li>
              </ol>
              <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-md mt-3 border border-blue-200 dark:border-blue-800">
                <h5 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  Requirements
                </h5>
                <ul className="mt-1 space-y-1">
                  <li className="flex items-start">
                    <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
                    <span className="text-sm text-blue-700 dark:text-blue-300">
                      URL must be publicly accessible with HTTPS
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
                    <span className="text-sm text-blue-700 dark:text-blue-300">
                      Self-signed SSL certificates not supported
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 dark:text-blue-400 mr-2">•</span>
                    <span className="text-sm text-blue-700 dark:text-blue-300">
                      For local testing, use ngrok to expose your server
                    </span>
                  </li>
                </ul>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
                  <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
                  After saving, use "Test" to verify your webhook configuration.
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
              {isLoadingToken ? (
                <div className="h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Input
                  id="github-content-type"
                  value={githubContentType}
                  onChange={(e) => setGithubContentType(e.target.value)}
                  placeholder="application/json"
                  className="flex-1"
                />
              )}
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

            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
                <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
                After saving, GitHub will send a ping event to verify your webhook.
              </p>
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

            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
                <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
                Stripe will send a test event to verify your webhook endpoint.
              </p>
            </div>
          </div>
        )
      case 'generic':
        return (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 mb-3">
              <div className="flex items-center h-3.5 space-x-2">
                <Checkbox
                  id="require-auth"
                  checked={requireAuth}
                  onCheckedChange={(checked) => setRequireAuth(checked as boolean)}
                />
                <Label htmlFor="require-auth" className="text-sm font-medium cursor-pointer">
                  Require Authentication
                </Label>
              </div>
            </div>

            {requireAuth && (
              <div className="space-y-4 ml-5 border-l-2 pl-4 border-gray-200 dark:border-gray-700">
                <div className="space-y-2">
                  <Label htmlFor="auth-token">Authentication Token</Label>
                  <div className="flex items-center space-x-2">
                    {isLoadingToken ? (
                      <div className="flex-1 h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <Input
                        id="auth-token"
                        value={generalToken}
                        onChange={(e) => setGeneralToken(e.target.value)}
                        placeholder="Enter an auth token"
                        className="flex-1"
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(generalToken, 'general-token')}
                      disabled={isLoadingToken}
                    >
                      {copied === 'general-token' ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This token will be used to authenticate requests to your webhook (via Bearer
                    token).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="header-name">Secret Header Name (Optional)</Label>
                  <Input
                    id="header-name"
                    value={secretHeaderName}
                    onChange={(e) => setSecretHeaderName(e.target.value)}
                    placeholder="X-Secret-Key"
                    className="flex-1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Custom HTTP header name for passing the authentication token instead of using
                    Bearer authentication.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="allowed-ips">Allowed IP Addresses (Optional)</Label>
              <Input
                id="allowed-ips"
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
                placeholder="192.168.1.1, 10.0.0.1"
                className="flex-1"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of IP addresses that are allowed to access this webhook.
              </p>
            </div>

            {testResult && testResult.success && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="p-3 rounded-md bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 border border-green-200 dark:border-green-800"
              >
                <p className="text-sm">{testResult.message}</p>
              </motion.div>
            )}

            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
              <h4 className="font-medium text-sm mb-2">Setup Instructions</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Copy the Webhook URL above</li>
                <li>Configure your service to send HTTP POST requests to this URL</li>
                {requireAuth && (
                  <>
                    <li>
                      {secretHeaderName
                        ? `Add the "${secretHeaderName}" header with your token to all requests`
                        : 'Add an "Authorization: Bearer YOUR_TOKEN" header to all requests'}
                    </li>
                  </>
                )}
              </ol>

              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
                  <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
                  The webhook will receive all HTTP POST requests and pass the data to your
                  workflow.
                </p>
              </div>
            </div>

            {testResult && testResult.success && testResult.test?.curlCommand && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="mt-3 bg-black/10 dark:bg-white/10 p-2 rounded text-xs font-mono overflow-x-auto relative group"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-6 w-6 opacity-70 hover:opacity-100"
                  onClick={() =>
                    copyToClipboard(testResult.test?.curlCommand || '', 'curl-command')
                  }
                >
                  {copied === 'curl-command' ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
                <pre className="whitespace-pre-wrap break-all pr-8">
                  {testResult.test.curlCommand}
                </pre>
              </motion.div>
            )}

            {testResult && !testResult.success && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="p-3 rounded-md bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800"
              >
                <p className="text-sm">{testResult.message}</p>
              </motion.div>
            )}
          </div>
        )
      default:
        return (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="require-auth"
                checked={requireAuth}
                onCheckedChange={(checked) => setRequireAuth(checked === true)}
                className="h-3.5 w-3.5"
              />
              <div>
                <Label htmlFor="require-auth" className="text-sm font-medium cursor-pointer">
                  Require Authentication
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enable authentication to secure your webhook endpoint.
                </p>
              </div>
            </div>

            {requireAuth && (
              <div className="space-y-4 pl-5 ml-1 border-l border-gray-200 dark:border-gray-700">
                <div className="space-y-2">
                  <Label htmlFor="auth-token">Authentication Token</Label>
                  <div className="flex items-center space-x-2">
                    {isLoadingToken ? (
                      <div className="flex-1 h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <Input
                        id="auth-token"
                        value={generalToken}
                        onChange={(e) => setGeneralToken(e.target.value)}
                        placeholder="Enter an authentication token"
                        className="flex-1"
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(generalToken, 'general-token')}
                      disabled={isLoadingToken}
                    >
                      {copied === 'general-token' ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This token will be used to authenticate requests to your webhook (via Bearer
                    token).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="header-name">Secret Header Name (Optional)</Label>
                  <Input
                    id="header-name"
                    value={secretHeaderName}
                    onChange={(e) => setSecretHeaderName(e.target.value)}
                    placeholder="X-Secret-Key"
                    className="flex-1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Custom HTTP header name for passing the authentication token instead of using
                    Bearer authentication.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="allowed-ips">Allowed IP Addresses (Optional)</Label>
              <Input
                id="allowed-ips"
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
                placeholder="192.168.1.1, 10.0.0.1"
                className="flex-1"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of IP addresses that are allowed to access this webhook.
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-3 border border-gray-200 dark:border-gray-700">
              <h4 className="font-medium text-sm mb-2">Setup Instructions</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Copy the Webhook URL above</li>
                <li>Configure your service to send HTTP POST requests to this URL</li>
                {requireAuth && (
                  <>
                    <li>
                      {secretHeaderName
                        ? `Add the "${secretHeaderName}" header with your token to all requests`
                        : 'Add an "Authorization: Bearer YOUR_TOKEN" header to all requests'}
                    </li>
                  </>
                )}
              </ol>

              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
                  <span className="text-gray-400 dark:text-gray-500 mr-2">💡</span>
                  The webhook will receive all HTTP POST requests and pass the data to your
                  workflow.
                </p>
              </div>
            </div>

            {testResult && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`p-3 rounded-md ${
                  testResult.success
                    ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}
              >
                <p className="text-sm">{testResult.message}</p>
              </motion.div>
            )}
          </div>
        )
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <div className="flex items-center space-x-2">
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
                >
                  {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {renderProviderContent()}
          </div>

          <DialogFooter className="flex justify-between mt-6 sticky bottom-0 py-3 bg-background border-t z-10">
            <div>
              {webhookId && (
                <div className="flex space-x-3">
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting || isLoadingToken}
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </>
                    )}
                  </Button>
                  {(webhookProvider === 'whatsapp' || webhookProvider === 'generic') && (
                    <Button
                      variant="outline"
                      onClick={testWebhook}
                      disabled={isTesting || isLoadingToken}
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        'Test'
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex space-x-3">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleSave}
                disabled={isSaving || isLoadingToken}
                className="bg-primary"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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

      <AlertDialog open={showUnsavedChangesConfirm} onOpenChange={setShowUnsavedChangesConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to close without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose} className="bg-red-600 hover:bg-red-700">
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
