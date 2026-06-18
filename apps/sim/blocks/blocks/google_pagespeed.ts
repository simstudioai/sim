import { GooglePagespeedIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { GooglePagespeedAnalyzeResponse } from '@/tools/google_pagespeed/types'

export const GooglePagespeedBlock: BlockConfig<GooglePagespeedAnalyzeResponse> = {
  type: 'google_pagespeed',
  name: 'Google PageSpeed',
  description: 'Analyze webpage performance with Google PageSpeed Insights',
  longDescription:
    'Analyze web pages for performance, accessibility, SEO, and best practices using Google PageSpeed Insights API powered by Lighthouse.',
  docsLink: 'https://docs.sim.ai/integrations/google_pagespeed',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
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

export const GooglePagespeedBlockMeta = {
  tags: ['google-workspace', 'seo', 'monitoring'],
  url: 'https://pagespeed.web.dev',
  templates: [
    {
      icon: GooglePagespeedIcon,
      title: 'PageSpeed monitor for top pages',
      prompt:
        'Create a scheduled workflow that runs Google PageSpeed Insights weekly against my top landing pages, writes mobile and desktop scores to a tables-based history, and flags regressions in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GooglePagespeedIcon,
      title: 'PageSpeed sitemap audit',
      prompt:
        'Build a workflow that takes a sitemap URL, runs Google PageSpeed Insights against every page in batches, summarizes Core Web Vitals across the site, and saves the report as a file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: GooglePagespeedIcon,
      title: 'PageSpeed pre-deploy gate',
      prompt:
        'Build a workflow triggered by a Vercel preview deployment that runs Google PageSpeed Insights against the preview URL, posts the scores as a GitHub PR comment, and fails the check if scores drop below threshold.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['vercel', 'github'],
    },
    {
      icon: GooglePagespeedIcon,
      title: 'PageSpeed CWV regression watcher',
      prompt:
        'Build a scheduled workflow that runs Google PageSpeed Insights daily for the top pages, captures Core Web Vitals, and pages on-call when LCP or CLS regress beyond threshold.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: GooglePagespeedIcon,
      title: 'PageSpeed accessibility tracker',
      prompt:
        'Build a scheduled weekly workflow that runs Google PageSpeed Insights with the accessibility audit, writes per-page scores to a tracking table, and opens Linear tickets on regressions.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: GooglePagespeedIcon,
      title: 'Core Web Vitals release gate',
      prompt:
        'Create a workflow triggered after a marketing-site deploy that runs Google PageSpeed Insights on the key landing pages for both mobile and desktop, compares Core Web Vitals against the prior baseline, and posts a pass/fail summary to Slack with the specific metrics that regressed.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'seo', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GooglePagespeedIcon,
      title: 'PageSpeed competitor benchmark',
      prompt:
        'Build a workflow that runs Google PageSpeed Insights against my homepage and a list of competitor URLs on mobile, compares the performance scores and Core Web Vitals side by side, and writes the ranked benchmark to a sheet.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
      alsoIntegrations: ['google_sheets'],
    },
  ],
  skills: [
    {
      name: 'audit-page-performance',
      description:
        'Run a PageSpeed Insights analysis on a URL and report scores and Core Web Vitals.',
      content:
        '# Audit Page Performance\n\nMeasure a page with PageSpeed Insights (Lighthouse).\n\n## Steps\n1. Take the page URL.\n2. Choose the Strategy: mobile (recommended for ranking) or desktop. Run once per strategy if both are needed.\n3. Optionally set Categories (performance, accessibility, best-practices, seo) and Locale.\n4. Run the analysis and read the category scores plus Core Web Vitals (LCP, FCP, CLS, TBT, Speed Index, TTI).\n\n## Output\nA report: per-category scores (0-100), Core Web Vitals with their display values, and the final URL analyzed. Call out any metric in the poor range and the strategy used.',
    },
    {
      name: 'compare-mobile-vs-desktop',
      description: 'Analyze a page on both mobile and desktop and contrast the scores and vitals.',
      content:
        "# Compare Mobile vs Desktop\n\nContrast a page's performance across form factors.\n\n## Steps\n1. Run the analysis on the URL with Strategy = mobile.\n2. Run it again with Strategy = desktop.\n3. Line up the category scores and Core Web Vitals from each run.\n4. Identify the biggest gaps (typically LCP/TBT on mobile).\n\n## Output\nA side-by-side comparison table of mobile vs desktop scores and key vitals, plus a short note on where mobile lags and what likely causes it.",
    },
    {
      name: 'track-core-web-vitals',
      description: 'Capture Core Web Vitals for one or more pages to feed a monitoring history.',
      content:
        '# Track Core Web Vitals\n\nCapture CWV metrics for trend tracking.\n\n## Steps\n1. For each target URL, run the analysis (usually Strategy = mobile) limiting Categories to performance for speed.\n2. Extract LCP, CLS, TBT, FCP, Speed Index, and TTI numeric values plus the performance score.\n3. Stamp each row with the URL and analysis timestamp.\n4. Compare against any prior baseline to detect regressions.\n\n## Output\nOne row per URL with the performance score and CWV numeric values, ready to append to a history table. Flag any metric that regressed beyond a threshold versus the baseline.',
    },
  ],
} as const satisfies BlockMeta
