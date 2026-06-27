import { GoogleAdsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleAdsBlockDisplay = {
  type: 'google_ads',
  name: 'Google Ads',
  description: 'Query campaigns, ad groups, and performance metrics',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleAdsIcon,
  longDescription:
    'Connect to Google Ads to list accessible accounts, list campaigns, view ad group details, get performance metrics, and run custom GAQL queries.',
  docsLink: 'https://docs.sim.ai/integrations/google_ads',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const GoogleAdsBlockMeta = {
  tags: ['marketing', 'google-workspace', 'data-analytics'],
  url: 'https://ads.google.com',
  templates: [
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads spend pacing',
      prompt:
        'Build a scheduled daily workflow that pulls Google Ads campaign spend, compares against monthly budget, and posts a Slack alert when any campaign is pacing more than 15% over.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads keyword performance report',
      prompt:
        'Create a scheduled weekly workflow that pulls Google Ads keyword performance, flags keywords with rising CPCs or dropping CTRs, and writes a recommendation list to a file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads negative-keyword finder',
      prompt:
        'Build a scheduled workflow that scans Google Ads search-term performance weekly, identifies irrelevant terms wasting spend, and writes a recommended negative-keyword list to a file for the team to review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads + Stripe ROAS tracker',
      prompt:
        'Create a scheduled workflow that joins Google Ads spend with Stripe revenue per campaign UTM, calculates true ROAS, and posts the per-channel breakdown to Slack each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'finance', 'reporting'],
      alsoIntegrations: ['stripe', 'slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads + PageSpeed landing audit',
      prompt:
        'Create a scheduled workflow that for active Google Ads campaigns runs Google PageSpeed on the landing pages weekly, flags slow LPs, and pings the marketing team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['google_pagespeed', 'slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads + Profound AI brand attribution',
      prompt:
        'Build a scheduled workflow that joins Google Ads spend per campaign with Profound AI brand-visibility scores, writes a true-attribution table, and posts findings to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
      alsoIntegrations: ['profound', 'slack'],
    },
    {
      icon: GoogleAdsIcon,
      title: 'Google Ads creative auditor',
      prompt:
        'Create a scheduled workflow that pulls Google Ads creatives, scores ad copy quality with an agent, and writes a per-campaign creative review file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'report-campaign-performance',
      description:
        'Pull Google Ads campaign performance for a date range and produce a clear metrics report.',
      content:
        '# Report Campaign Performance\n\nUse Google Ads to summarize how campaigns are performing.\n\n## Steps\n1. List campaigns for the customer to know what is active.\n2. Use Campaign Performance over the chosen date range to pull impressions, clicks, cost, conversions, CTR, CPC, and ROAS.\n3. Rank campaigns by spend and by efficiency to surface what is working and what is not.\n\n## Output\nReturn a per-campaign metrics table plus a short narrative: top performers, underperformers, and where spend is being wasted. Note the date range used.',
    },
    {
      name: 'analyze-ad-performance',
      description:
        'Pull ad-level Google Ads performance and identify the best and worst creatives in each ad group.',
      content:
        '# Analyze Ad Performance\n\nUse Google Ads to compare creatives within campaigns.\n\n## Steps\n1. List ad groups for the target campaign or customer.\n2. Use Ad Performance over the date range to pull per-ad clicks, conversions, CTR, and cost.\n3. Within each ad group, identify the strongest and weakest ads.\n\n## Output\nReturn, per ad group, the best and worst performing ads with their key metrics, plus a recommendation (scale, pause, or rewrite). Keep recommendations tied to the data.',
    },
    {
      name: 'run-gaql-query',
      description:
        'Run a custom GAQL query against Google Ads to answer a specific reporting question.',
      content:
        '# Run GAQL Query\n\nUse Google Ads to answer an ad-hoc reporting question with GAQL.\n\n## Steps\n1. Clarify the metrics, dimensions, and segments the question needs.\n2. Write a valid GAQL query (SELECT fields FROM resource WHERE conditions) scoped to the customer and date range.\n3. Use the Custom Query operation to run it and read the rows.\n\n## Output\nReturn the result rows as a clean table along with the GAQL query that produced them, so the analysis is reproducible.',
    },
  ],
} as const satisfies BlockMeta
