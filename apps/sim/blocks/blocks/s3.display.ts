import { S3Icon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const S3BlockDisplay = {
  type: 's3',
  name: 'S3',
  description: 'Upload, download, list, and manage S3 files',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #1B660F 0%, #6CAE3E 100%)',
  icon: S3Icon,
  longDescription:
    'Integrate S3 into the workflow. Upload files, download objects, list bucket contents, delete objects, and copy objects between buckets. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/s3',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay
