import { ContextDevIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ContextDevBlockDisplay = {
  type: 'context_dev',
  name: 'Context.dev',
  description: 'Scrape, crawl, search, extract, and enrich web and brand data',
  category: 'tools',
  bgColor: '#ffffff',
  icon: ContextDevIcon,
  longDescription:
    'Integrate Context.dev into the workflow. Scrape pages to markdown or HTML, capture screenshots, list images, crawl entire sites, map sitemaps, search the web, extract structured data and products, pull design systems, classify industries, and retrieve brand assets by domain, name, email, ticker, or transaction — all from one API.',
  docsLink: 'https://docs.sim.ai/integrations/context_dev',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const ContextDevBlockMeta = {
  tags: ['web-scraping', 'enrichment', 'automation'],
  url: 'https://www.context.dev',
  templates: [
    {
      icon: ContextDevIcon,
      title: 'Context.dev knowledge-base builder',
      prompt:
        'Build a workflow that maps a documentation site with Context.dev, crawls each page to clean markdown, chunks and embeds the content, and upserts it into a knowledge base for an answering agent.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'sync'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev competitor monitor',
      prompt:
        'Build a scheduled workflow that scrapes competitor pricing and changelog pages to markdown with Context.dev weekly, diffs against the prior snapshot, logs changes to a table, and posts notable updates to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev lead enrichment',
      prompt:
        'Create a workflow that takes a work email, uses Context.dev to retrieve brand data by email and classify the company into NAICS codes, and writes the enriched firmographics to a CRM record.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['enrichment', 'sales'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev structured data extractor',
      prompt:
        'Build a workflow that takes a website URL and a JSON schema, uses Context.dev Extract to pull structured fields across the site, and returns the validated records as JSON.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'research'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev research brief',
      prompt:
        'Create an agent that runs a Context.dev web search on a topic, scrapes the top results to markdown, and synthesizes a cited research brief saved as a file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev design-system extractor',
      prompt:
        'Build a workflow that takes a domain, uses Context.dev to scrape its styleguide and fonts plus a homepage screenshot, and stores the design tokens and assets as files for a design handoff.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['design', 'research'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev transaction enrichment',
      prompt:
        'Create a workflow that takes raw bank transaction descriptors, uses Context.dev to identify the merchant brand behind each one, and appends the resolved company and logo to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enrichment', 'automation'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev product catalog importer',
      prompt:
        "Build a workflow that takes a brand domain, uses Context.dev to extract the brand's product catalog with pricing and features, and writes each product as a row in a table.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enrichment', 'automation'],
    },
    {
      icon: ContextDevIcon,
      title: 'Context.dev site change watcher',
      prompt:
        'Build a scheduled workflow that maps a site sitemap with Context.dev, scrapes new or changed pages to markdown, summarizes the differences, and emails a digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
} as const satisfies BlockMeta
