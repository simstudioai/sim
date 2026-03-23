import { GooglePagespeedIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import type { GooglePagespeedAnalyzeResponse } from '@/tools/google_pagespeed/types'

export const GooglePagespeedBlock: BlockConfig<GooglePagespeedAnalyzeResponse> = {
  type: 'google_pagespeed',
  name: 'Google PageSpeed',
  description: 'Analyze webpage performance with Google PageSpeed Insights',
  longDescription:
    'Analyze web pages for performance, accessibility, SEO, and best practices using Google PageSpeed Insights API powered by Lighthouse.',
  docsLink: 'https://docs.sim.ai/tools/google_pagespeed',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  tags: ['google-workspace', 'seo', 'monitoring'],
  bgColor: '#E0E0E0',
  icon: GooglePagespeedIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://example.com',
    },
    {
      id: 'strategy',
      title: 'Strategy',
      type: 'dropdown',
      options: [
        { label: 'Desktop', id: 'desktop' },
        { label: 'Mobile', id: 'mobile' },
      ],
      value: () => 'desktop',
    },
    {
      id: 'category',
      title: 'Categories',
      type: 'short-input',
      placeholder: 'performance, accessibility, best-practices, seo',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of Google PageSpeed Insights categories to analyze. Valid values are: performance, accessibility, best-practices, seo. Return ONLY the comma-separated list - no explanations, no extra text.',
      },
    },
    {
      id: 'locale',
      title: 'Locale',
      type: 'short-input',
      placeholder: 'en',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Google PageSpeed API key',
      password: true,
      hideWhenHosted: true,
    },
  ],

  tools: {
    access: ['google_pagespeed_analyze'],
    config: {
      tool: () => 'google_pagespeed_analyze',
    },
  },

  inputs: {
    url: { type: 'string', description: 'URL to analyze' },
    strategy: { type: 'string', description: 'Analysis strategy (desktop or mobile)' },
    category: { type: 'string', description: 'Comma-separated categories to analyze' },
    locale: { type: 'string', description: 'Locale for results' },
    apiKey: { type: 'string', description: 'Google PageSpeed API key' },
  },

  outputs: {
    response: {
      type: 'json',
      description:
        'PageSpeed analysis results including category scores (performanceScore, accessibilityScore, bestPracticesScore, seoScore), Core Web Vitals display values and numeric values (firstContentfulPaint, largestContentfulPaint, totalBlockingTime, cumulativeLayoutShift, speedIndex, interactive), and metadata (finalUrl, overallCategory, analysisTimestamp, lighthouseVersion)',
    },
  },
}
