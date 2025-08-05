import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  AirtableIcon,
  DiscordIcon,
  GithubIcon,
  GmailIcon,
  MicrosoftTeamsIcon,
  OutlookIcon,
  SlackIcon,
  StripeIcon,
  TelegramIcon,
  WhatsAppIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { WebhookModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/webhook/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('WebhookConfig')

export interface WebhookProvider {
  id: string
  name: string
  icon: (props: { className?: string }) => React.ReactNode
  configFields: {
    [key: string]: {
      type: 'string' | 'boolean' | 'select'
      label: string
      placeholder?: string
      options?: string[]
      defaultValue?: string | boolean
      description?: string
    }
  }
}

// Define provider-specific configuration types
export interface WhatsAppConfig {
  verificationToken: string
}

export interface GitHubConfig {
  contentType: string
}

export interface DiscordConfig {
  webhookName?: string
  avatarUrl?: string
}

export type StripeConfig = Record<string, never>

export interface GeneralWebhookConfig {
  token?: string
  secretHeaderName?: string
  requireAuth?: boolean
  allowedIps?: string[]
}

export interface SlackConfig {
  signingSecret: string
}

export interface GmailConfig {
  credentialId?: string
  labelIds?: string[]
  labelFilterBehavior?: 'INCLUDE' | 'EXCLUDE'
  markAsRead?: boolean
  includeRawEmail?: boolean
  maxEmailsPerPoll?: number
}

export interface OutlookConfig {
  credentialId?: string
  folderIds?: string[]
  folderFilterBehavior?: 'INCLUDE' | 'EXCLUDE'
  markAsRead?: boolean
  includeRawEmail?: boolean
  maxEmailsPerPoll?: number
}

// Define Airtable-specific configuration type
export interface AirtableWebhookConfig {
  baseId: string
  tableId: string
  externalId?: string // To store the ID returned by Airtable
  includeCellValuesInFieldIds?: 'all' | undefined
  webhookSecret?: string
}

export interface TelegramConfig {
  botToken?: string
}

export interface MicrosoftTeamsConfig {
  hmacSecret: string
}

// Union type for all provider configurations
export type ProviderConfig =
  | WhatsAppConfig
  | GitHubConfig
  | DiscordConfig
  | StripeConfig
  | GeneralWebhookConfig
  | SlackConfig
  | AirtableWebhookConfig
  | TelegramConfig
  | GmailConfig
  | OutlookConfig
  | MicrosoftTeamsConfig
  | Record<string, never>

// Define available webhook providers
export const WEBHOOK_PROVIDERS: { [key: string]: WebhookProvider } = {
  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: (props) => <WhatsAppIcon {...props} />,
    configFields: {
      verificationToken: {
        type: 'string',
        label: 'Verification Token',
        placeholder: 'Enter a verification token for WhatsApp',
        description: 'This token will be used to verify your webhook with WhatsApp.',
      },
    },
  },
  github: {
    id: 'github',
    name: 'GitHub',
    icon: (props) => <GithubIcon {...props} />,
    configFields: {
      contentType: {
        type: 'string',
        label: 'Content Type',
        placeholder: 'application/json',
        defaultValue: 'application/json',
        description: 'The content type for GitHub webhook payloads.',
      },
    },
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    icon: (props) => <GmailIcon {...props} />,
    configFields: {
      labelFilterBehavior: {
        type: 'select',
        label: 'Label Filter Behavior',
        options: ['INCLUDE', 'EXCLUDE'],
        defaultValue: 'INCLUDE',
        description: 'Whether to include or exclude the selected labels.',
      },
      markAsRead: {
        type: 'boolean',
        label: 'Mark As Read',
        defaultValue: false,
        description: 'Mark emails as read after processing.',
      },
      includeRawEmail: {
        type: 'boolean',
        label: 'Include Raw Email Data',
        defaultValue: false,
        description: 'Include the complete, unprocessed email data from Gmail.',
      },
      maxEmailsPerPoll: {
        type: 'string',
        label: 'Max Emails Per Poll',
        defaultValue: '10',
        description: 'Maximum number of emails to process in each check.',
      },
      pollingInterval: {
        type: 'string',
        label: 'Polling Interval (minutes)',
        defaultValue: '5',
        description: 'How often to check for new emails.',
      },
    },
  },
  outlook: {
    id: 'outlook',
    name: 'Outlook',
    icon: (props) => <OutlookIcon {...props} />,
    configFields: {
      folderFilterBehavior: {
        type: 'select',
        label: 'Folder Filter Behavior',
        options: ['INCLUDE', 'EXCLUDE'],
        defaultValue: 'INCLUDE',
        description: 'Whether to include or exclude emails from specified folders.',
      },
      markAsRead: {
        type: 'boolean',
        label: 'Mark as Read',
        defaultValue: false,
        description: 'Automatically mark processed emails as read.',
      },
      includeRawEmail: {
        type: 'boolean',
        label: 'Include Raw Email Data',
        defaultValue: false,
        description: 'Include the complete, unprocessed email data from Outlook.',
      },
      maxEmailsPerPoll: {
        type: 'string',
        label: 'Max Emails Per Poll',
        defaultValue: '10',
        description: 'Maximum number of emails to process in each check.',
      },
      pollingInterval: {
        type: 'string',
        label: 'Polling Interval (minutes)',
        defaultValue: '5',
        description: 'How often to check for new emails.',
      },
    },
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    icon: (props) => <DiscordIcon {...props} />,
    configFields: {
      webhookName: {
        type: 'string',
        label: 'Webhook Name',
        placeholder: 'Enter a name for the webhook',
        description: 'Custom name that will appear as the message sender in Discord.',
      },
      avatarUrl: {
        type: 'string',
        label: 'Avatar URL',
        placeholder: 'https://example.com/avatar.png',
        description: 'URL to an image that will be used as the webhook avatar.',
      },
    },
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    icon: (props) => <StripeIcon {...props} />,
    configFields: {},
  },
  generic: {
    id: 'generic',
    name: 'General',
    icon: (props) => (
      <div
        className={`flex items-center justify-center rounded ${props.className || ''}`}
        style={{
          backgroundColor: '#802FFF',
          minWidth: '28px',
          padding: '0 4px',
        }}
      >
        <span className='font-medium text-white text-xs'>Sim</span>
      </div>
    ),
    configFields: {
      token: {
        type: 'string',
        label: 'Authentication Token',
        placeholder: 'Enter an auth token (optional)',
        description:
          'This token will be used to authenticate webhook requests via Bearer token authentication.',
      },
      secretHeaderName: {
        type: 'string',
        label: 'Secret Header Name',
        placeholder: 'X-Secret-Key',
        description: 'Custom HTTP header name for authentication (optional).',
      },
      requireAuth: {
        type: 'boolean',
        label: 'Require Authentication',
        defaultValue: false,
        description: 'Require authentication for all webhook requests.',
      },
      allowedIps: {
        type: 'string',
        label: 'Allowed IP Addresses',
        placeholder: '10.0.0.1, 192.168.1.1',
        description: 'Comma-separated list of allowed IP addresses (optional).',
      },
    },
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    icon: (props) => <SlackIcon {...props} />,
    configFields: {
      signingSecret: {
        type: 'string',
        label: 'Signing Secret',
        placeholder: 'Enter your Slack app signing secret',
        description: 'The signing secret from your Slack app to validate request authenticity.',
      },
    },
  },
  airtable: {
    id: 'airtable',
    name: 'Airtable',
    icon: (props) => <AirtableIcon {...props} />,
    configFields: {
      baseId: {
        type: 'string',
        label: 'Base ID',
        placeholder: 'appXXXXXXXXXXXXXX',
        description: 'The ID of the Airtable Base the webhook should monitor.',
        defaultValue: '', // Default empty, user must provide
      },
      tableId: {
        type: 'string',
        label: 'Table ID',
        placeholder: 'tblXXXXXXXXXXXXXX',
        description: 'The ID of the Airtable Table within the Base to monitor.',
        defaultValue: '', // Default empty, user must provide
      },
    },
  },
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    icon: (props) => <TelegramIcon {...props} />,
    configFields: {
      botToken: {
        type: 'string',
        label: 'Bot Token',
        placeholder: 'Enter your Telegram Bot Token',
        description: 'The token for your Telegram bot.',
      },
    },
  },
  microsoftteams: {
    id: 'microsoftteams',
    name: 'Microsoft Teams',
    icon: (props) => <MicrosoftTeamsIcon {...props} />,
    configFields: {
      hmacSecret: {
        type: 'string',
        label: 'HMAC Secret',
        placeholder: 'Enter HMAC secret from Teams outgoing webhook',
        description:
          'The security token provided by Teams when creating an outgoing webhook. Used to verify request authenticity.',
      },
    },
  },
}

interface WebhookConfigProps {
  blockId: string
  subBlockId?: string
  isConnecting: boolean
  isPreview?: boolean
  value?: {
    webhookProvider?: string
    webhookPath?: string
    providerConfig?: ProviderConfig
  }
  disabled?: boolean
}

export function WebhookConfig({
  blockId,
  subBlockId,
  isConnecting,
  isPreview = false,
  value: propValue,
  disabled = false,
}: WebhookConfigProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [webhookId, setWebhookId] = useState<string | null>(null)
  const params = useParams()
  const workflowId = params.workflowId as string
  const [isLoading, setIsLoading] = useState(false)

  // No need to manage webhook status separately - it's determined by having provider + path

  // Get the webhook provider from the block state
  const [storeWebhookProvider, setWebhookProvider] = useSubBlockValue(blockId, 'webhookProvider')

  // Store the webhook path
  const [storeWebhookPath, setWebhookPath] = useSubBlockValue(blockId, 'webhookPath')

  // Store Gmail credential from the dedicated subblock
  const [storeGmailCredential, setGmailCredential] = useSubBlockValue(blockId, 'gmailCredential')

  // Store Outlook credential from the dedicated subblock
  const [storeOutlookCredential, setOutlookCredential] = useSubBlockValue(
    blockId,
    'outlookCredential'
  )

  // Don't auto-generate webhook paths - only create them when user actually configures a webhook
  // This prevents the "Active Webhook" badge from showing on unconfigured blocks

  // Store provider-specific configuration
  const [storeProviderConfig, setProviderConfig] = useSubBlockValue(blockId, 'providerConfig')

  // Use prop values when available (preview mode), otherwise use store values
  const webhookProvider = propValue?.webhookProvider ?? storeWebhookProvider
  const webhookPath = propValue?.webhookPath ?? storeWebhookPath
  const providerConfig = propValue?.providerConfig ?? storeProviderConfig
  const gmailCredentialId = storeGmailCredential || ''
  const outlookCredentialId = storeOutlookCredential || ''

  // Store the actual provider from the database
  const [actualProvider, setActualProvider] = useState<string | null>(null)

  // Track the previous provider to detect changes
  const [previousProvider, setPreviousProvider] = useState<string | null>(null)

  // Handle provider changes - clear webhook data when switching providers
  useEffect(() => {
    // Skip on initial load or if no provider is set
    if (!webhookProvider || !previousProvider) {
      setPreviousProvider(webhookProvider)
      return
    }

    // If the provider has changed, clear all webhook-related data
    if (webhookProvider !== previousProvider) {
      // IMPORTANT: Store the current webhook ID BEFORE clearing it
      const currentWebhookId = webhookId

      logger.info('Webhook provider changed, clearing webhook data', {
        from: previousProvider,
        to: webhookProvider,
        blockId,
        webhookId: currentWebhookId,
      })

      // If there's an existing webhook, delete it from the database
      const deleteExistingWebhook = async () => {
        if (currentWebhookId && !isPreview) {
          try {
            logger.info('Deleting existing webhook due to provider change', {
              webhookId: currentWebhookId,
              oldProvider: previousProvider,
              newProvider: webhookProvider,
            })

            const response = await fetch(`/api/webhooks/${currentWebhookId}`, {
              method: 'DELETE',
            })

            if (!response.ok) {
              const errorData = await response.json()
              logger.error('Failed to delete existing webhook', {
                webhookId: currentWebhookId,
                error: errorData.error,
              })
            } else {
              logger.info('Successfully deleted existing webhook', { webhookId: currentWebhookId })

              const store = useSubBlockStore.getState()
              const workflowValues = store.workflowValues[workflowId] || {}
              const blockValues = { ...workflowValues[blockId] }

              // Clear webhook-related fields
              blockValues.webhookPath = undefined
              blockValues.providerConfig = undefined

              // Update the store with the cleaned block values
              useSubBlockStore.setState({
                workflowValues: {
                  ...workflowValues,
                  [workflowId]: {
                    ...workflowValues,
                    [blockId]: blockValues,
                  },
                },
              })

              logger.info('Cleared webhook data from store after successful deletion', { blockId })
            }
          } catch (error: any) {
            logger.error('Error deleting existing webhook', {
              webhookId: currentWebhookId,
              error: error.message,
            })
          }
        }
      }

      // Clear webhook fields FIRST to make badge disappear immediately
      // Then delete from database to prevent the webhook check useEffect from restoring the path

      // IMPORTANT: Clear webhook connection data FIRST
      // This prevents the webhook check useEffect from finding and restoring the webhook
      setWebhookId(null)
      setActualProvider(null)

      // Clear provider config
      setProviderConfig({})

      // Clear component state
      setError(null)
      setGmailCredential('')
      setOutlookCredential('')

      // Note: Store will be cleared AFTER successful database deletion
      // This ensures store and database stay perfectly in sync

      // Update previous provider to the new provider
      setPreviousProvider(webhookProvider)

      // Delete existing webhook AFTER clearing the path to prevent race condition
      // The webhook check useEffect won't restore the path if we clear it first
      // Execute deletion asynchronously but don't block the UI

      ;(async () => {
        await deleteExistingWebhook()
      })()
    }
  }, [webhookProvider, previousProvider, blockId, webhookId, isPreview])

  // Reset provider config when provider changes (legacy effect - keeping for safety)
  useEffect(() => {
    if (webhookProvider) {
      // Reset the provider config when the provider changes
      setProviderConfig({})

      // Clear webhook ID and actual provider when switching providers
      // This ensures the webhook status is properly reset
      if (webhookProvider !== actualProvider) {
        setWebhookId(null)
        setActualProvider(null)
      }

      // Provider config is reset - webhook status will be determined by provider + path existence
    }
  }, [webhookProvider, webhookId, actualProvider])

  // Check if webhook exists in the database
  useEffect(() => {
    // Skip API calls in preview mode
    if (isPreview) {
      setIsLoading(false)
      return
    }

    const checkWebhook = async () => {
      setIsLoading(true)
      try {
        // Check if there's a webhook for this specific block
        // Always include blockId - every webhook should be associated with a specific block
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook
            setWebhookId(webhook.id)

            // Don't automatically update the provider - let user control it
            // The user should be able to change providers even when a webhook exists

            // Store the actual provider from the database
            setActualProvider(webhook.provider)

            // Update the path in the block state if it's different
            if (webhook.path && webhook.path !== webhookPath) {
              setWebhookPath(webhook.path)
            }

            // Webhook found - status will be determined by provider + path existence
          } else {
            setWebhookId(null)
            setActualProvider(null)

            // IMPORTANT: Clear stale webhook data from store when no webhook found in database
            // This ensures the reactive badge status updates correctly on page refresh
            if (webhookPath) {
              setWebhookPath('')
              logger.info('Cleared stale webhook path on page refresh - no webhook in database', {
                blockId,
                clearedPath: webhookPath,
              })
            }

            // No webhook found - reactive blockWebhookStatus will now be false
          }
        }
      } catch (error) {
        logger.error('Error checking webhook:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    checkWebhook()
  }, [workflowId, blockId, isPreview]) // Removed webhookPath dependency to prevent race condition with provider changes

  const handleOpenModal = () => {
    if (isPreview || disabled) return
    setIsModalOpen(true)
    setError(null)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleSaveWebhook = async (path: string, config: ProviderConfig) => {
    if (isPreview || disabled) return false

    try {
      setIsSaving(true)
      setError(null)

      // Set the webhook path in the block state
      if (path && path !== webhookPath) {
        setWebhookPath(path)
      }

      let finalConfig = config
      if (webhookProvider === 'gmail' && gmailCredentialId) {
        finalConfig = {
          ...config,
          credentialId: gmailCredentialId,
        }
      } else if (webhookProvider === 'outlook' && outlookCredentialId) {
        finalConfig = {
          ...config,
          credentialId: outlookCredentialId,
        }
      }

      // Set the provider config in the block state
      setProviderConfig(finalConfig)

      // Save the webhook to the database
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          blockId,
          path,
          provider: webhookProvider || 'generic',
          providerConfig: finalConfig,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(
          typeof errorData.error === 'object'
            ? errorData.error.message || JSON.stringify(errorData.error)
            : errorData.error || 'Failed to save webhook'
        )
      }

      const data = await response.json()
      const savedWebhookId = data.webhook.id
      setWebhookId(savedWebhookId)

      logger.info('Webhook saved successfully', {
        webhookId: savedWebhookId,
        provider: webhookProvider,
        path,
        blockId,
      })

      // Update the actual provider after saving
      setActualProvider(webhookProvider || 'generic')

      // Webhook saved successfully - status will be determined by provider + path existence

      return true
    } catch (error: any) {
      logger.error('Error saving webhook:', { error })
      setError(error.message || 'Failed to save webhook configuration')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteWebhook = async () => {
    if (isPreview || disabled) return false

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

      // Reset the startWorkflow field to manual
      useSubBlockStore.getState().setValue(blockId, 'startWorkflow', 'manual')

      // Remove webhook-specific fields from the block state
      const store = useSubBlockStore.getState()
      const workflowValues = store.workflowValues[workflowId] || {}
      const blockValues = { ...workflowValues[blockId] }

      // Remove webhook-related fields
      blockValues.webhookProvider = undefined
      blockValues.providerConfig = undefined
      blockValues.webhookPath = undefined

      // Update the store with the cleaned block values
      store.setValue(blockId, 'startWorkflow', 'manual')
      useSubBlockStore.setState({
        workflowValues: {
          ...workflowValues,
          [workflowId]: {
            ...workflowValues,
            [blockId]: blockValues,
          },
        },
      })

      // Clear component state
      setWebhookId(null)
      setActualProvider(null)

      // Webhook deleted - status will be determined by provider + path existence
      handleCloseModal()

      return true
    } catch (error: any) {
      logger.error('Error deleting webhook:', { error })
      setError(error.message || 'Failed to delete webhook')
      return false
    } finally {
      setIsDeleting(false)
    }
  }

  // Get provider icon based on the current provider
  const getProviderIcon = () => {
    // Only show provider icon if the webhook is connected and the selected provider matches the actual provider
    if (!webhookId || webhookProvider !== actualProvider) {
      return null
    }

    const provider = WEBHOOK_PROVIDERS[webhookProvider || 'generic']
    return provider.icon({
      className: 'h-4 w-4 mr-2 text-green-500 dark:text-green-400',
    })
  }

  // Check if the webhook is connected for the selected provider
  const isWebhookConnected = webhookId && webhookProvider === actualProvider

  // For Gmail, show configure button when credential is available and webhook not connected
  if (webhookProvider === 'gmail' && !isWebhookConnected) {
    return (
      <div className='w-full'>
        {error && <div className='mb-2 text-red-500 text-sm dark:text-red-400'>{error}</div>}

        {gmailCredentialId && (
          <Button
            variant='outline'
            size='sm'
            className='flex h-10 w-full items-center bg-background font-normal text-sm'
            onClick={handleOpenModal}
            disabled={
              isConnecting || isSaving || isDeleting || !gmailCredentialId || isPreview || disabled
            }
          >
            {isLoading ? (
              <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
            ) : (
              <ExternalLink className='mr-2 h-4 w-4' />
            )}
            Configure Webhook
          </Button>
        )}

        {isModalOpen && (
          <WebhookModal
            isOpen={isModalOpen}
            onClose={handleCloseModal}
            webhookPath={webhookPath || ''}
            webhookProvider={webhookProvider || 'generic'}
            onSave={handleSaveWebhook}
            onDelete={handleDeleteWebhook}
            webhookId={webhookId || undefined}
          />
        )}
      </div>
    )
  }

  // For Outlook, show configure button when credential is available and webhook not connected
  if (webhookProvider === 'outlook' && !isWebhookConnected) {
    return (
      <div className='w-full'>
        {error && <div className='mb-2 text-red-500 text-sm dark:text-red-400'>{error}</div>}

        {outlookCredentialId && (
          <Button
            variant='outline'
            size='sm'
            className='flex h-10 w-full items-center bg-background font-normal text-sm'
            onClick={handleOpenModal}
            disabled={
              isConnecting ||
              isSaving ||
              isDeleting ||
              !outlookCredentialId ||
              isPreview ||
              disabled
            }
          >
            {isLoading ? (
              <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
            ) : (
              <ExternalLink className='mr-2 h-4 w-4' />
            )}
            Configure Webhook
          </Button>
        )}

        {isModalOpen && (
          <WebhookModal
            isOpen={isModalOpen}
            onClose={handleCloseModal}
            webhookPath={webhookPath || ''}
            webhookProvider={webhookProvider || 'generic'}
            onSave={handleSaveWebhook}
            onDelete={handleDeleteWebhook}
            webhookId={webhookId || undefined}
          />
        )}
      </div>
    )
  }

  return (
    <div className='w-full'>
      {error && <div className='mb-2 text-red-500 text-sm dark:text-red-400'>{error}</div>}

      {isWebhookConnected ? (
        <div className='flex flex-col space-y-2'>
          <div
            className='flex h-10 cursor-pointer items-center justify-center rounded border border-border bg-background px-3 py-2 transition-colors duration-200 hover:bg-accent hover:text-accent-foreground'
            onClick={handleOpenModal}
          >
            <div className='flex items-center gap-2'>
              <div className='flex items-center'>
                {getProviderIcon()}
                <span className='font-normal text-sm'>
                  {WEBHOOK_PROVIDERS[webhookProvider || 'generic'].name} Webhook
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          className='flex h-10 w-full items-center bg-background font-normal text-sm'
          onClick={handleOpenModal}
          disabled={isConnecting || isSaving || isDeleting || isPreview || disabled}
        >
          {isLoading ? (
            <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          ) : (
            <ExternalLink className='mr-2 h-4 w-4' />
          )}
          Configure Webhook
        </Button>
      )}

      {isModalOpen && (
        <WebhookModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          webhookPath={webhookPath || ''}
          webhookProvider={webhookProvider || 'generic'}
          onSave={handleSaveWebhook}
          onDelete={handleDeleteWebhook}
          webhookId={webhookId || undefined}
        />
      )}
    </div>
  )
}
