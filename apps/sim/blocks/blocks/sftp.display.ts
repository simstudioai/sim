import { SftpIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SftpBlockDisplay = {
  type: 'sftp',
  name: 'SFTP',
  description: 'Transfer files via SFTP (SSH File Transfer Protocol)',
  category: 'tools',
  bgColor: '#2D3748',
  icon: SftpIcon,
  longDescription:
    'Upload, download, list, and manage files on remote servers via SFTP. Supports both password and private key authentication for secure file transfers.',
  docsLink: 'https://docs.sim.ai/integrations/sftp',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
