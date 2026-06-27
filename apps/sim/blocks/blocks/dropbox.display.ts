import { DropboxIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DropboxBlockDisplay = {
  type: 'dropbox',
  name: 'Dropbox',
  description: 'Upload, download, share, and manage files in Dropbox',
  category: 'tools',
  bgColor: '#0061FF',
  icon: DropboxIcon,
  iconColor: '#0061FF',
  longDescription:
    'Integrate Dropbox into your workflow for file management, sharing, and collaboration. Upload files, download content, create folders, manage shared links, and more.',
  docsLink: 'https://docs.sim.ai/integrations/dropbox',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
