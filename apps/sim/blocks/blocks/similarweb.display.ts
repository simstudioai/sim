import { SimilarwebIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SimilarwebBlockDisplay = {
  type: 'similarweb',
  name: 'Similarweb',
  description: 'Website traffic and analytics data',
  category: 'tools',
  bgColor: '#000922',
  icon: SimilarwebIcon,
  longDescription:
    'Access comprehensive website analytics including traffic estimates, engagement metrics, rankings, and traffic sources using the Similarweb API.',
  docsLink: 'https://developers.similarweb.com/docs/similarweb-web-traffic-api',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
