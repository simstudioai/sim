/**
 * Maximum length for block names
 */
export const MAX_BLOCK_NAME_LENGTH = 18

/**
 * Debounce delay for resize updates (in milliseconds)
 */
export const RESIZE_DEBOUNCE_DELAY = 100

/**
 * Webhook provider display names
 */
export const WEBHOOK_PROVIDERS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  github: 'GitHub',
  discord: 'Discord',
  stripe: 'Stripe',
  generic: 'General',
  slack: 'Slack',
  airtable: 'Airtable',
  gmail: 'Gmail',
} as const
