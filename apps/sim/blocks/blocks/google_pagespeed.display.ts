import { GooglePagespeedIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GooglePagespeedBlockDisplay = {
  type: 'google_pagespeed',
  name: 'Google PageSpeed',
  description: 'Analyze webpage performance with Google PageSpeed Insights',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GooglePagespeedIcon,
  longDescription:
    'Analyze web pages for performance, accessibility, SEO, and best practices using Google PageSpeed Insights API powered by Lighthouse.',
  docsLink: 'https://docs.sim.ai/integrations/google_pagespeed',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
