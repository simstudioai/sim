import { GooglePagespeedBlockDisplay } from '@/blocks/blocks/google_pagespeed.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { GooglePagespeedAnalyzeResponse } from '@/tools/google_pagespeed/types'

export const GooglePagespeedBlock: BlockConfig<GooglePagespeedAnalyzeResponse> = {
  ...GooglePagespeedBlockDisplay,
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
    finalUrl: { type: 'string', description: 'The final URL after redirects' },
    performanceScore: { type: 'number', description: 'Performance category score (0-1)' },
    accessibilityScore: { type: 'number', description: 'Accessibility category score (0-1)' },
    bestPracticesScore: { type: 'number', description: 'Best Practices category score (0-1)' },
    seoScore: { type: 'number', description: 'SEO category score (0-1)' },
    firstContentfulPaint: {
      type: 'string',
      description: 'Time to First Contentful Paint (display value)',
    },
    firstContentfulPaintMs: {
      type: 'number',
      description: 'Time to First Contentful Paint in milliseconds',
    },
    largestContentfulPaint: {
      type: 'string',
      description: 'Time to Largest Contentful Paint (display value)',
    },
    largestContentfulPaintMs: {
      type: 'number',
      description: 'Time to Largest Contentful Paint in milliseconds',
    },
    totalBlockingTime: { type: 'string', description: 'Total Blocking Time (display value)' },
    totalBlockingTimeMs: { type: 'number', description: 'Total Blocking Time in milliseconds' },
    cumulativeLayoutShift: {
      type: 'string',
      description: 'Cumulative Layout Shift (display value)',
    },
    cumulativeLayoutShiftValue: {
      type: 'number',
      description: 'Cumulative Layout Shift numeric value',
    },
    speedIndex: { type: 'string', description: 'Speed Index (display value)' },
    speedIndexMs: { type: 'number', description: 'Speed Index in milliseconds' },
    interactive: { type: 'string', description: 'Time to Interactive (display value)' },
    interactiveMs: { type: 'number', description: 'Time to Interactive in milliseconds' },
    overallCategory: {
      type: 'string',
      description: 'Overall loading experience category (FAST, AVERAGE, SLOW, or NONE)',
    },
    analysisTimestamp: { type: 'string', description: 'UTC timestamp of the analysis' },
    lighthouseVersion: {
      type: 'string',
      description: 'Version of Lighthouse used for the analysis',
    },
  },
}
