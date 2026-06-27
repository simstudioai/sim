import { GoogleDriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleDriveBlockDisplay = {
  type: 'google_drive',
  name: 'Google Drive',
  description: 'Manage files, folders, and permissions',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleDriveIcon,
  longDescription:
    'Integrate Google Drive into the workflow. Can create, upload, download, copy, move, delete, share files and manage permissions.',
  docsLink: 'https://docs.sim.ai/integrations/google_drive',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
