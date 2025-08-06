import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console/logger'
import {
  AirtableConfig,
  DeleteConfirmDialog,
  DiscordConfig,
  GenericConfig,
  GithubConfig,
  GmailConfig,
  MicrosoftTeamsConfig,
  OutlookConfig,
  SlackConfig,
  StripeConfig,
  TelegramConfig,
  UnsavedChangesDialog,
  WebhookDialogFooter,
  WebhookUrlField,
  WhatsAppConfig,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/webhook/components'
import {
  type ProviderConfig,
  WEBHOOK_PROVIDERS,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/webhook/webhook'

const logger = createLogger('WebhookModal')

interface WebhookModalProps {
  isOpen: boolean
  onClose: () => void
  webhookPath: string
  webhookProvider: string
  onSave?: (path: string, providerConfig: ProviderConfig) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  webhookId?: string
}

export function WebhookModal({
  isOpen,
  onClose,
  webhookPath,
  webhookProvider,
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
  const [isCurrentConfigValid, setIsCurrentConfigValid] = useState(true)

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
  const [slackSigningSecret, setSlackSigningSecret] = useState('')
  const [telegramBotToken, setTelegramBotToken] = useState('')
  // Microsoft Teams-specific state
  const [microsoftTeamsHmacSecret, setMicrosoftTeamsHmacSecret] = useState('')
  // Airtable-specific state
  const [airtableWebhookSecret, _setAirtableWebhookSecret] = useState('')
  const [airtableBaseId, setAirtableBaseId] = useState('')
  const [airtableTableId, setAirtableTableId] = useState('')
  const [airtableIncludeCellValues, setAirtableIncludeCellValues] = useState(false)

  // State for storing initial values to detect changes
  const [originalValues, setOriginalValues] = useState({
    webhookProvider,
    webhookPath,
    slackSigningSecret: '',
    whatsappVerificationToken: '',
    githubContentType: 'application/json',
    generalToken: '',
    secretHeaderName: '',
    requireAuth: false,
    allowedIps: '',
    discordWebhookName: '',
    discordAvatarUrl: '',
    airtableWebhookSecret: '',
    airtableBaseId: '',
    airtableTableId: '',
    airtableIncludeCellValues: false,
    telegramBotToken: '',
    microsoftTeamsHmacSecret: '',
    selectedLabels: ['INBOX'] as string[],
    labelFilterBehavior: 'INCLUDE',
    markAsRead: false,
    includeRawEmail: false,
  })

  const [selectedLabels, setSelectedLabels] = useState<string[]>(['INBOX'])
  const [labelFilterBehavior, setLabelFilterBehavior] = useState<'INCLUDE' | 'EXCLUDE'>('INCLUDE')
  const [markAsRead, setMarkAsRead] = useState<boolean>(false)
  const [includeRawEmail, setIncludeRawEmail] = useState<boolean>(false)

  // Get the current provider configuration
  // const provider = WEBHOOK_PROVIDERS[webhookProvider] || WEBHOOK_PROVIDERS.generic

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
              } else if (webhookProvider === 'slack' && 'signingSecret' in config) {
                const signingSecret = config.signingSecret || ''
                setSlackSigningSecret(signingSecret)
                setOriginalValues((prev) => ({ ...prev, slackSigningSecret: signingSecret }))
              } else if (webhookProvider === 'airtable') {
                const baseIdVal = config.baseId || ''
                const tableIdVal = config.tableId || ''
                const includeCells = config.includeCellValuesInFieldIds === 'all'

                setAirtableBaseId(baseIdVal)
                setAirtableTableId(tableIdVal)
                setAirtableIncludeCellValues(includeCells)

                setOriginalValues((prev) => ({
                  ...prev,
                  airtableBaseId: baseIdVal,
                  airtableTableId: tableIdVal,
                  airtableIncludeCellValues: includeCells,
                }))
              } else if (webhookProvider === 'telegram') {
                const botToken = config.botToken || ''

                setTelegramBotToken(botToken)

                setOriginalValues((prev) => ({
                  ...prev,
                  telegramBotToken: botToken,
                }))
              } else if (webhookProvider === 'gmail') {
                const labelIds = config.labelIds || []
                const labelFilterBehavior = config.labelFilterBehavior || 'INCLUDE'

                setSelectedLabels(labelIds)
                setLabelFilterBehavior(labelFilterBehavior)

                setOriginalValues((prev) => ({
                  ...prev,
                  selectedLabels: labelIds,
                  labelFilterBehavior,
                }))

                if (config.markAsRead !== undefined) {
                  setMarkAsRead(config.markAsRead)
                  setOriginalValues((prev) => ({ ...prev, markAsRead: config.markAsRead }))
                }

                if (config.includeRawEmail !== undefined) {
                  setIncludeRawEmail(config.includeRawEmail)
                  setOriginalValues((prev) => ({
                    ...prev,
                    includeRawEmail: config.includeRawEmail,
                  }))
                }
              } else if (webhookProvider === 'outlook') {
                const folderIds = config.folderIds || []
                const folderFilterBehavior = config.folderFilterBehavior || 'INCLUDE'

                setSelectedLabels(folderIds) // Reuse selectedLabels for folder IDs
                setLabelFilterBehavior(folderFilterBehavior) // Reuse labelFilterBehavior for folders

                setOriginalValues((prev) => ({
                  ...prev,
                  selectedLabels: folderIds,
                  labelFilterBehavior: folderFilterBehavior,
                }))

                if (config.markAsRead !== undefined) {
                  setMarkAsRead(config.markAsRead)
                  setOriginalValues((prev) => ({ ...prev, markAsRead: config.markAsRead }))
                }

                if (config.includeRawEmail !== undefined) {
                  setIncludeRawEmail(config.includeRawEmail)
                  setOriginalValues((prev) => ({
                    ...prev,
                    includeRawEmail: config.includeRawEmail,
                  }))
                }
              } else if (webhookProvider === 'microsoftteams') {
                const hmacSecret = config.hmacSecret || ''

                setMicrosoftTeamsHmacSecret(hmacSecret)

                setOriginalValues((prev) => ({
                  ...prev,
                  microsoftTeamsHmacSecret: hmacSecret,
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
          allowedIps !== originalValues.allowedIps)) ||
      (webhookProvider === 'slack' && slackSigningSecret !== originalValues.slackSigningSecret) ||
      (webhookProvider === 'airtable' &&
        (airtableWebhookSecret !== originalValues.airtableWebhookSecret ||
          airtableBaseId !== originalValues.airtableBaseId ||
          airtableTableId !== originalValues.airtableTableId ||
          airtableIncludeCellValues !== originalValues.airtableIncludeCellValues)) ||
      (webhookProvider === 'telegram' && telegramBotToken !== originalValues.telegramBotToken) ||
      (webhookProvider === 'gmail' &&
        (!selectedLabels.every((label) => originalValues.selectedLabels.includes(label)) ||
          !originalValues.selectedLabels.every((label) => selectedLabels.includes(label)) ||
          labelFilterBehavior !== originalValues.labelFilterBehavior ||
          markAsRead !== originalValues.markAsRead ||
          includeRawEmail !== originalValues.includeRawEmail)) ||
      (webhookProvider === 'microsoftteams' &&
        microsoftTeamsHmacSecret !== originalValues.microsoftTeamsHmacSecret)

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
    slackSigningSecret,
    airtableWebhookSecret,
    airtableBaseId,
    airtableTableId,
    airtableIncludeCellValues,
    telegramBotToken,
    selectedLabels,
    labelFilterBehavior,
    markAsRead,
    includeRawEmail,
    microsoftTeamsHmacSecret,
  ])

  // Validate required fields for current provider
  useEffect(() => {
    let isValid = true
    switch (webhookProvider) {
      case 'airtable':
        isValid = airtableBaseId.trim() !== '' && airtableTableId.trim() !== ''
        break
      case 'slack':
        isValid = slackSigningSecret.trim() !== ''
        break
      case 'whatsapp':
        isValid = whatsappVerificationToken.trim() !== ''
        break
      case 'github':
        isValid = generalToken.trim() !== ''
        break
      case 'discord':
        isValid = discordWebhookName.trim() !== ''
        break
      case 'telegram':
        isValid = telegramBotToken.trim() !== ''
        break
      case 'gmail':
        isValid = selectedLabels.length > 0
        break
      case 'microsoftteams':
        isValid = microsoftTeamsHmacSecret.trim() !== ''
        break
    }
    setIsCurrentConfigValid(isValid)
  }, [
    webhookProvider,
    airtableBaseId,
    airtableTableId,
    slackSigningSecret,
    whatsappVerificationToken,
    telegramBotToken,
    selectedLabels,
    microsoftTeamsHmacSecret,
  ])

  const formattedPath = useMemo(() => {
    return webhookPath && webhookPath.trim() !== '' ? webhookPath : crypto.randomUUID()
  }, [webhookPath])

  // Construct the full webhook URL
  const baseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'https://your-domain.com'

  const webhookUrl = `${baseUrl}/api/webhooks/trigger/${formattedPath}`

  const copyToClipboard = (text: string, type: string): void => {
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
      case 'gmail':
        return {
          labelIds: selectedLabels,
          labelFilterBehavior,
          markAsRead,
          includeRawEmail,
          maxEmailsPerPoll: 25,
        }
      case 'outlook':
        return {
          folderIds: selectedLabels, // Reuse selectedLabels for folder IDs
          folderFilterBehavior: labelFilterBehavior, // Reuse labelFilterBehavior for folders
          markAsRead,
          includeRawEmail,
          maxEmailsPerPoll: 25,
        }
      case 'generic': {
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
      }
      case 'slack':
        return { signingSecret: slackSigningSecret }
      case 'airtable':
        return {
          webhookSecret: airtableWebhookSecret || undefined,
          baseId: airtableBaseId,
          tableId: airtableTableId,
          includeCellValuesInFieldIds: airtableIncludeCellValues ? 'all' : undefined,
        }
      case 'telegram':
        return {
          botToken: telegramBotToken || undefined,
        }
      case 'microsoftteams':
        return {
          hmacSecret: microsoftTeamsHmacSecret,
        }
      default:
        return {}
    }
  }

  const handleSave = async () => {
    logger.debug('Saving webhook...')
    if (!isCurrentConfigValid) {
      logger.warn('Attempted to save with invalid configuration')
      // Add user feedback for invalid configuration
      setTestResult({
        success: false,
        message: 'Cannot save: Please fill in all required fields for the selected provider.',
      })
      return
    }

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
        const saveSuccessful = await onSave(pathToSave, providerConfig)
        await new Promise((resolve) => setTimeout(resolve, 100))

        if (saveSuccessful) {
          setOriginalValues({
            webhookProvider,
            webhookPath,
            whatsappVerificationToken,
            githubContentType,
            generalToken,
            secretHeaderName,
            requireAuth,
            allowedIps,
            discordWebhookName,
            discordAvatarUrl,
            slackSigningSecret,
            airtableWebhookSecret,
            airtableBaseId,
            airtableTableId,
            airtableIncludeCellValues,
            telegramBotToken,
            microsoftTeamsHmacSecret,
            selectedLabels,
            labelFilterBehavior,
            markAsRead,
            includeRawEmail,
          })
          setHasUnsavedChanges(false)
          setTestResult({
            success: true,
            message: 'Webhook configuration saved successfully.',
          })
        } else {
          setTestResult({
            success: false,
            message: 'Failed to save webhook configuration. Please try again.',
          })
        }
      }
    } catch (error: any) {
      logger.error('Error saving webhook:', error)
      setTestResult({
        success: false,
        message:
          error instanceof Error ? error.message : 'An error occurred while saving the webhook',
      })
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

      // Check if response is ok before trying to parse JSON
      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = 'Failed to test webhook'

        try {
          // Try to parse as JSON, but handle case where it's not valid JSON
          const errorData = JSON.parse(errorText)
          errorMessage = errorData.message || errorData.error || errorMessage
        } catch (_parseError) {
          // If JSON parsing fails, use the raw text if it exists
          errorMessage = errorText || errorMessage
        }

        throw new Error(errorMessage)
      }

      // Parse JSON only after confirming response is ok
      const data = await response.json()

      // If the test was successful, show a success message
      if (data.success) {
        setTestResult({
          success: true,
          message: data.message || 'Webhook configuration is valid.',
          test: data.test,
        })
      } else {
        // For Telegram, provide more specific error messages
        if (webhookProvider === 'telegram') {
          const errorMessage = data.message || data.error || 'Webhook test failed'
          if (errorMessage.includes('SSL')) {
            setTestResult({
              success: false,
              message:
                'Telegram webhooks require HTTPS. Please ensure your domain has a valid SSL certificate.',
            })
          } else {
            setTestResult({
              success: false,
              message: `Telegram webhook test failed: ${errorMessage}`,
            })
          }
        } else {
          setTestResult({
            success: false,
            message: data.message || data.error || 'Webhook test failed with success=false',
          })
        }
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
      case 'gmail':
        return (
          <GmailConfig
            selectedLabels={selectedLabels}
            setSelectedLabels={setSelectedLabels}
            labelFilterBehavior={labelFilterBehavior}
            setLabelFilterBehavior={setLabelFilterBehavior}
            markAsRead={markAsRead}
            setMarkAsRead={setMarkAsRead}
            includeRawEmail={includeRawEmail}
            setIncludeRawEmail={setIncludeRawEmail}
          />
        )
      case 'outlook':
        return (
          <OutlookConfig
            selectedLabels={selectedLabels}
            setSelectedLabels={setSelectedLabels}
            labelFilterBehavior={labelFilterBehavior}
            setLabelFilterBehavior={setLabelFilterBehavior}
            markAsRead={markAsRead}
            setMarkAsRead={setMarkAsRead}
            includeRawEmail={includeRawEmail}
            setIncludeRawEmail={setIncludeRawEmail}
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
      case 'slack':
        return (
          <SlackConfig
            signingSecret={slackSigningSecret}
            setSigningSecret={setSlackSigningSecret}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
            testWebhook={testWebhook}
            webhookUrl={webhookUrl}
          />
        )
      case 'airtable':
        return (
          <AirtableConfig
            baseId={airtableBaseId}
            setBaseId={setAirtableBaseId}
            tableId={airtableTableId}
            setTableId={setAirtableTableId}
            includeCellValues={airtableIncludeCellValues}
            setIncludeCellValues={setAirtableIncludeCellValues}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
            testWebhook={testWebhook}
            webhookId={webhookId}
            webhookUrl={webhookUrl}
          />
        )
      case 'telegram':
        return (
          <TelegramConfig
            botToken={telegramBotToken}
            setBotToken={setTelegramBotToken}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
            testWebhook={testWebhook}
            webhookId={webhookId}
            webhookUrl={webhookUrl}
          />
        )
      case 'microsoftteams':
        return (
          <MicrosoftTeamsConfig
            hmacSecret={microsoftTeamsHmacSecret}
            setHmacSecret={setMicrosoftTeamsHmacSecret}
            isLoadingToken={isLoadingToken}
            testResult={testResult}
            copied={copied}
            copyToClipboard={copyToClipboard}
            testWebhook={testWebhook}
          />
        )
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

  // Get provider name for the title
  const getProviderTitle = () => {
    const provider = WEBHOOK_PROVIDERS[webhookProvider] || WEBHOOK_PROVIDERS.generic
    return provider.name || 'Webhook'
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className='flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
          hideCloseButton
        >
          <DialogHeader className='border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <DialogTitle className='font-medium text-lg'>
                {webhookId ? 'Edit' : 'Configure'} {getProviderTitle()} Webhook
              </DialogTitle>
              <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleClose}>
                <X className='h-4 w-4' />
                <span className='sr-only'>Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className='flex-grow overflow-y-auto px-6 pt-4 pb-6'>
            {webhookProvider !== 'slack' && webhookProvider !== 'airtable' && (
              <WebhookUrlField
                webhookUrl={webhookUrl}
                isLoadingToken={isLoadingToken}
                copied={copied}
                copyToClipboard={copyToClipboard}
              />
            )}

            {renderProviderContent()}
          </div>

          <DialogFooter className='w-full border-t px-6 pt-0 pt-4 pb-6'>
            <WebhookDialogFooter
              webhookId={webhookId}
              webhookProvider={webhookProvider}
              isSaving={isSaving}
              isDeleting={isDeleting}
              isLoadingToken={isLoadingToken}
              isTesting={isTesting}
              isCurrentConfigValid={isCurrentConfigValid}
              onSave={handleSave}
              onDelete={() => setShowDeleteConfirm(true)}
              onTest={testWebhook}
              onClose={handleClose}
            />
          </DialogFooter>
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
