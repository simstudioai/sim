import { MicrosoftOneDriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const OneDriveBlockDisplay = {
  type: 'onedrive',
  name: 'OneDrive',
  description: 'Create, upload, download, list, and delete files',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftOneDriveIcon,
  longDescription:
    'Integrate OneDrive into the workflow. Can create text and Excel files, upload files, download files, list files, and delete files or folders.',
  docsLink: 'https://docs.sim.ai/integrations/onedrive',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
