import {
  AirtableIcon,
  DiscordIcon,
  GithubIcon,
  GmailIcon,
  MicrosoftTeamsIcon,
  OutlookIcon,
  SignalIcon,
  SlackIcon,
  StripeIcon,
  TelegramIcon,
  WebhookIcon,
  WhatsAppIcon,
} from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

const getWebhookProviderIcon = (provider: string) => {
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    slack: SlackIcon,
    gmail: GmailIcon,
    outlook: OutlookIcon,
    airtable: AirtableIcon,
    telegram: TelegramIcon,
    generic: SignalIcon,
    whatsapp: WhatsAppIcon,
    github: GithubIcon,
    discord: DiscordIcon,
    stripe: StripeIcon,
    microsoftteams: MicrosoftTeamsIcon,
  }

  return iconMap[provider.toLowerCase()]
}

export const WebhookBlock: BlockConfig = {
  type: 'webhook',
  name: 'Webhook',
  description: 'Trigger workflow execution from external webhooks',
  authMode: AuthMode.OAuth,
  category: 'triggers',
  icon: WebhookIcon,
  bgColor: '#10B981', // Green color for triggers
  triggerAllowed: true,
  hideFromToolbar: true, // Hidden for backwards compatibility - use generic webhook trigger instead

  subBlocks: [
    {
      id: 'webhookProvider',
      title: 'Webhook Provider',
      type: 'dropdown',
      options: [
        'slack',
        'gmail',
        'outlook',
        'airtable',
        'telegram',
        'generic',
        'whatsapp',
        'github',
        'discord',
        'stripe',
        'microsoftteams',
      ].map((provider) => {
        const providerLabels = {
          slack: 'Slack',
          gmail: 'Gmail',
          outlook: 'Outlook',
          airtable: 'Airtable',
          telegram: 'Telegram',
          generic: 'Generic',
          whatsapp: 'WhatsApp',
          github: 'GitHub',
          discord: 'Discord',
          stripe: 'Stripe',
          microsoftteams: 'Microsoft Teams',
        }

        const icon = getWebhookProviderIcon(provider)
        return {
          label: providerLabels[provider as keyof typeof providerLabels],
          id: provider,
          ...(icon && { icon }),
        }
      }),
      value: () => 'generic',
    },
    {
      id: 'gmailCredential',
      title: 'Gmail Account',
      type: 'oauth-input',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.labels',
      ],
      placeholder: 'Select Gmail account',
      condition: { field: 'webhookProvider', value: 'gmail' },
      required: true,
    },
    {
      id: 'outlookCredential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      provider: 'outlook',
      serviceId: 'outlook',
      requiredScopes: [
        'Mail.ReadWrite',
        'Mail.ReadBasic',
        'Mail.Read',
        'Mail.Send',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
      condition: { field: 'webhookProvider', value: 'outlook' },
      required: true,
    },
    {
      id: 'webhookConfig',
      title: 'Webhook Configuration',
      type: 'webhook-config',
    },
  ],

  tools: {
    access: [], // No external tools needed
  },

  inputs: {}, // No inputs - webhook triggers receive data externally

  outputs: {}, // No outputs - webhook data is injected directly into workflow context
}
