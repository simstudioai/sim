import { GoogleGroupsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleGroupsBlockDisplay = {
  type: 'google_groups',
  name: 'Google Groups',
  description: 'Manage Google Workspace Groups and their members',
  category: 'tools',
  bgColor: '#E8F0FE',
  icon: GoogleGroupsIcon,
  longDescription:
    'Connect to Google Workspace to create, update, and manage groups and their members using the Admin SDK Directory API.',
  docsLink: 'https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
