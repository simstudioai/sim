import { AirweaveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AirweaveBlockDisplay = {
  type: 'airweave',
  name: 'Airweave',
  description: 'Search your synced data collections',
  category: 'tools',
  bgColor: '#6366F1',
  icon: AirweaveIcon,
  iconColor: '#6366F1',
  longDescription:
    'Search across your synced data sources using Airweave. Supports semantic search with hybrid, neural, or keyword retrieval strategies. Optionally generate AI-powered answers from search results.',
  docsLink: 'https://docs.sim.ai/integrations/airweave',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const AirweaveBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  url: 'https://airweave.ai',
  templates: [
    {
      icon: AirweaveIcon,
      title: 'Airweave cross-source answerer',
      prompt:
        'Build a workflow that takes a user question, searches across your Airweave-synced sources — Notion, Confluence, Drive — and returns an AI-generated answer with sourced citations.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave + agent answer endpoint',
      prompt:
        'Create an agent that searches an Airweave-managed retrieval layer, answers user questions with sourced citations, and deploys as a chat endpoint for internal teams.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'enterprise'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave daily knowledge digest',
      prompt:
        'Build a scheduled workflow that runs a set of standing Airweave searches each morning, summarizes the freshest results per topic, and posts a digest to Slack for the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave research-to-table',
      prompt:
        'Create a workflow that takes a list of research questions, runs an Airweave search for each, and writes the top answers with their citations into a table for review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'automation'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave answer-quality checker',
      prompt:
        'Build a scheduled workflow that runs a benchmark set of questions against Airweave, has an agent grade each answer for relevance and citation quality, and writes a quality report to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave + Slack Q&A',
      prompt:
        'Create a Slack bot that searches an Airweave-managed retrieval layer to answer questions in support channels with sourced citations.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'community'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AirweaveIcon,
      title: 'Airweave weekly topic tracker',
      prompt:
        'Build a scheduled weekly workflow that searches Airweave for updates on tracked topics, summarizes what is new since last week, and writes a report for the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'answer-from-collection',
      description:
        'Search an Airweave collection across synced sources and answer a question with grounded, cited results.',
      content:
        '# Answer From Collection\n\nUse Airweave to retrieve current context across connected apps and answer a question.\n\n## Steps\n1. Take the user question and search the relevant Airweave collection.\n2. Review the top results, noting which source each came from (docs, tickets, CRM, etc.).\n3. Synthesize an answer grounded only in the retrieved content.\n4. If the collection returns nothing relevant, say so instead of guessing.\n\n## Output\nA concise answer with citations back to the source records. Do not include claims unsupported by the results.',
    },
    {
      name: 'build-context-brief',
      description:
        'Search an Airweave collection for a person, account, or project and compile a context brief from all sources.',
      content:
        '# Build Context Brief\n\nGather everything Airweave knows about a subject across synced sources into one brief.\n\n## Steps\n1. Search the collection for the subject (account name, project, customer, or person).\n2. Pull relevant hits from each source type and group them.\n3. Summarize the current state, recent activity, and any open items.\n\n## Output\nA short brief organized by source, highlighting the most recent and relevant facts plus open questions.',
    },
  ],
} as const satisfies BlockMeta
