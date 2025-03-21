import { useEffect, useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console-logger'
import { ProviderConfig, WEBHOOK_PROVIDERS } from '../webhook-config'
import { DiscordConfig } from './providers/discord-config'
import { GenericConfig } from './providers/generic-config'
import { GithubConfig } from './providers/github-config'
import { StripeConfig } from './providers/stripe-config'
import { WhatsAppConfig } from './providers/whatsapp-config'
import { DeleteConfirmDialog } from './ui/confirmation'
import { UnsavedChangesDialog } from './ui/confirmation'
import { WebhookDialogFooter } from './ui/webhook-footer'
import { WebhookDialogHeader } from './ui/webhook-header'
import { WebhookUrlField } from './ui/webhook-url'

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

  // Generic webhook state
  const [generalToken, setGeneralToken] = useState('')
  const [secretHeaderName, setSecretHeaderName] = useState('')
  const [requireAuth, setRequireAuth] = useState(false)
  const [allowedIps, setAllowedIps] = useState('')

  // Provider-specific state
  const [whatsappVerificationToken, setWhatsappVerificationToken] = useState('')
  const [githubContentType, setGithubContentType] = useState('application/json')
  const [discordWebhookName, setDiscordWebhookName] = useState('')
  const [discordAvatarUrl, setDiscordAvatarUrl] = useState('')

  // Original values to track changes
  const [originalValues, setOriginalValues] = useState({
    whatsappVerificationToken: '',
    githubContentType: 'application/json',
    generalToken: '',
    secretHeaderName: '',
    requireAuth: false,
    allowedIps: '',
    discordWebhookName: '',
    discordAvatarUrl: '',
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
              } else if (webhookProvider === 'discord') {
                const webhookName = config.webhookName || ''
                const avatarUrl = config.avatarUrl || ''

                setDiscordWebhookName(webhookName)
                setDiscordAvatarUrl(avatarUrl)

                setOriginalValues((prev) => ({
                  ...prev,
                  discordWebhookName: webhookName,
                  discordAvatarUrl: avatarUrl,
                }))
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
    const hasChanges =
      (webhookProvider === 'whatsapp' &&
        whatsappVerificationToken !== originalValues.whatsappVerificationToken) ||
      (webhookProvider === 'github' && githubContentType !== originalValues.githubContentType) ||
      (webhookProvider === 'discord' &&
        (discordWebhookName !== originalValues.discordWebhookName ||
          discordAvatarUrl !== originalValues.discordAvatarUrl)) ||
      (webhookProvider === 'generic' &&
        (generalToken !== originalValues.generalToken ||
          secretHeaderName !== originalValues.secretHeaderName ||
          requireAuth !== originalValues.requireAuth ||
          allowedIps !== originalValues.allowedIps))

    setHasUnsavedChanges(hasChanges)
  }, [
    webhookProvider,
    whatsappVerificationToken,
    githubContentType,
    discordWebhookName,
    discordAvatarUrl,
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
      case 'discord':
        return {
          webhookName: discordWebhookName || undefined,
          avatarUrl: discordAvatarUrl || undefined,
        }
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
          discordWebhookName,
          discordAvatarUrl,
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

  // Provider-specific component rendering
  const renderProviderContent = () => {
    switch (webhookProvider) {
      case 'whatsapp':
        return (
          <WhatsAppConfig
            verificationToken={whatsappVerificationToken}
            setVerificationToken={setWhatsappVerificationToken}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
          />
        )
      case 'github':
        return (
          <GithubConfig
            contentType={githubContentType}
            setContentType={setGithubContentType}
            webhookSecret={generalToken}
            setWebhookSecret={setGeneralToken}
            sslVerification={requireAuth ? 'enabled' : 'disabled'}
            setSslVerification={(value) => setRequireAuth(value === 'enabled')}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
            testWebhook={testWebhook}
          />
        )
      case 'discord':
        return (
          <DiscordConfig
            webhookName={discordWebhookName}
            setWebhookName={setDiscordWebhookName}
            avatarUrl={discordAvatarUrl}
            setAvatarUrl={setDiscordAvatarUrl}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
            testWebhook={testWebhook}
          />
        )
      case 'stripe':
        return (
          <StripeConfig
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
          />
        )
      case 'generic':
      default:
        return (
          <GenericConfig
            requireAuth={requireAuth}
            setRequireAuth={setRequireAuth}
            generalToken={generalToken}
            setGeneralToken={setGeneralToken}
            secretHeaderName={secretHeaderName}
            setSecretHeaderName={setSecretHeaderName}
            allowedIps={allowedIps}
            setAllowedIps={setAllowedIps}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
            testWebhook={testWebhook}
          />
        )
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[675px] max-h-[90vh] overflow-hidden flex flex-col">
          <WebhookDialogHeader webhookProvider={webhookProvider} webhookId={webhookId} />

          <div className="space-y-4 py-2 px-2 overflow-y-auto flex-grow pb-6">
            <WebhookUrlField
              webhookUrl={webhookUrl}
              isLoadingToken={isLoadingToken}
              copied={copied}
              copyToClipboard={copyToClipboard}
            />

            {renderProviderContent()}
          </div>

          <WebhookDialogFooter
            webhookId={webhookId}
            webhookProvider={webhookProvider}
            isSaving={isSaving}
            isDeleting={isDeleting}
            isLoadingToken={isLoadingToken}
            isTesting={isTesting}
            onSave={handleSave}
            onDelete={() => setShowDeleteConfirm(true)}
            onTest={testWebhook}
            onClose={handleClose}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        setOpen={setShowDeleteConfirm}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />

      <UnsavedChangesDialog
        open={showUnsavedChangesConfirm}
        setOpen={setShowUnsavedChangesConfirm}
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />
    </>
  )
}
