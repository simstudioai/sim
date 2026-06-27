import { GoogleVaultIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleVaultBlockDisplay = {
  type: 'google_vault',
  name: 'Google Vault',
  description: 'Search, export, and manage holds/exports for Vault matters',
  category: 'tools',
  bgColor: '#E8F0FE',
  icon: GoogleVaultIcon,
  longDescription:
    'Connect Google Vault to create exports, list exports, and manage holds within matters.',
  docsLink: 'https://developers.google.com/vault',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
