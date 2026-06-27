import { StagehandIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const StagehandBlockDisplay = {
  type: 'stagehand',
  name: 'Stagehand',
  description: 'Web automation and data extraction',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  longDescription:
    'Integrate Stagehand into the workflow. Can extract structured data from webpages or run an autonomous agent to perform tasks.',
  docsLink: 'https://docs.sim.ai/integrations/stagehand',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const StagehandBlockMeta = {
  tags: ['web-scraping', 'automation', 'agentic'],
  url: 'https://www.stagehand.dev',
  templates: [
    {
      icon: StagehandIcon,
      title: 'Stagehand QA navigator',
      prompt:
        'Build a workflow that uses Stagehand to run scripted browser flows against staging, captures screenshots and assertion outcomes per step, and writes a regression report file.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand booking automator',
      prompt:
        'Create a workflow that uses Stagehand to log into supplier portals, place recurring orders from a tables-defined catalog, and write confirmation numbers back to the orders table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'ecommerce'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand price-monitor sweep',
      prompt:
        'Build a scheduled workflow that uses Stagehand to navigate a catalog of supplier sites, capture current prices and stock for items in a tracking table, and alert Slack on threshold breaches.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand competitor product trial',
      prompt:
        'Build a workflow that uses Stagehand to walk through competitor product trials weekly, captures screenshots of every step, and writes a UX-comparison file.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand onboarding-flow auditor',
      prompt:
        'Create a workflow that uses Stagehand to test the production onboarding flow daily, captures friction points, and writes a UX regression table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand structured lead extractor',
      prompt:
        'Build a workflow that uses Stagehand to visit a list of company sites from a table, extracts structured fields — company name, contact email, pricing tier, and key features — into a defined schema, and writes the clean records back into a research table for the sales team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand autonomous task runner',
      prompt:
        'Create a workflow that hands Stagehand a natural-language goal like "find the latest pricing on this vendor site and download the PDF", lets the Stagehand agent navigate and act on the page autonomously, and saves the captured result and screenshots to files.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'research', 'agentic'],
    },
  ],
  skills: [
    {
      name: 'extract-structured-data',
      description:
        'Use Stagehand to extract structured fields from a web page into a typed result.',
      content:
        '# Extract Structured Data\n\nPull clean, structured data off a single web page.\n\n## Steps\n1. Run the Extract Data operation with the target URL.\n2. Describe exactly what to extract and the shape you want (for example product name, price, and availability), so Stagehand returns typed fields rather than raw HTML.\n3. Choose the LLM provider for the extraction.\n\n## Output\nReturn the extracted fields as a structured object, and note any field the page did not contain so downstream steps can handle gaps.',
    },
    {
      name: 'run-browser-agent-task',
      description:
        'Hand Stagehand a natural-language goal and let its agent navigate and act on a site autonomously.',
      content:
        '# Run Browser Agent Task\n\nDelegate a multi-step web task to the Stagehand agent.\n\n## Steps\n1. Run the Run Agent operation with a clear natural-language goal (for example find the latest pricing on a vendor site and capture it).\n2. Provide the starting URL and pick the execution mode (DOM, hybrid, or CUA) and the LLM provider appropriate to the task.\n3. Let the agent navigate, click, and read pages to complete the goal.\n\n## Output\nReturn the agent result, the key data it captured, and any screenshots, plus a short note if the goal could not be fully completed.',
    },
    {
      name: 'monitor-page-for-changes',
      description:
        'Periodically extract a value from a web page with Stagehand and report when it changes.',
      content:
        '# Monitor Page for Changes\n\nWatch a specific value on a web page over time.\n\n## Steps\n1. Run the Extract Data operation against the target URL, extracting just the value to watch (price, stock status, headline).\n2. Compare the extracted value against the last known value stored from a previous run.\n3. Decide whether the value changed beyond a meaningful threshold.\n\n## Output\nReport the current extracted value, whether it changed since the last check, and the old and new values when a change is detected.',
    },
  ],
} as const satisfies BlockMeta
