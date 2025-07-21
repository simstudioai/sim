import {
  AirtableIcon,
  DiscordIcon,
  GithubIcon,
  GmailIcon,
  SignalIcon,
  SlackIcon,
  StripeIcon,
  TelegramIcon,
  WebhookIcon,
  WhatsAppIcon,
} from '@/components/icons'
import type { BlockConfig } from '../types'

const getWebhookProviderIcon = (provider: string) => {
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    slack: SlackIcon,
    gmail: GmailIcon,
    airtable: AirtableIcon,
    telegram: TelegramIcon,
    generic: SignalIcon,
    whatsapp: WhatsAppIcon,
    github: GithubIcon,
    discord: DiscordIcon,
    stripe: StripeIcon,
  }

  return iconMap[provider.toLowerCase()]
}

export const WebhookBlock: BlockConfig = {
  type: 'webhook',
  name: 'Webhook',
  description: 'Trigger workflow execution from external webhooks',
  category: 'triggers',
  icon: WebhookIcon,
  bgColor: '#10B981', // Green color for triggers

  subBlocks: [
    {
      id: 'webhookProvider',
      title: 'Webhook Provider',
      type: 'dropdown',
      layout: 'full',
      options: [
        'slack',
        'gmail',
        'airtable',
        'telegram',
        'generic',
        'whatsapp',
        'github',
        'discord',
        'stripe',
      ].map((provider) => {
        const providerLabels = {
          slack: 'Slack',
          gmail: 'Gmail',
          airtable: 'Airtable',
          telegram: 'Telegram',
          generic: 'Generic',
          whatsapp: 'WhatsApp',
          github: 'GitHub',
          discord: 'Discord',
          stripe: 'Stripe',
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
      id: 'webhookConfig',
      title: 'Webhook Configuration',
      type: 'webhook-config',
      layout: 'full',
    },
  ],

  tools: {
    access: [], // No external tools needed
  },

  inputs: {}, // No inputs - webhook triggers are pure input sources

  outputs: {}, // No outputs - webhook data is injected directly into workflow context
}
