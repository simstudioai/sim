import { AhrefsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AhrefsBlockDisplay = {
  type: 'ahrefs',
  name: 'Ahrefs',
  description: 'SEO analysis with Ahrefs',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: AhrefsIcon,
  longDescription:
    'Integrate Ahrefs SEO tools into your workflow. Analyze domain ratings, backlinks, organic keywords, top pages, and more. Requires an Ahrefs Enterprise plan with API access.',
  docsLink: 'https://docs.ahrefs.com/docs/api/reference/introduction',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
