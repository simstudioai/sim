import { GooglePagespeedIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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
