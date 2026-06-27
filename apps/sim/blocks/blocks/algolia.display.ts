import { AlgoliaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AlgoliaBlockDisplay = {
  type: 'algolia',
  name: 'Algolia',
  description: 'Search and manage Algolia indices',
  category: 'tools',
  bgColor: '#003DFF',
  icon: AlgoliaIcon,
  iconColor: '#003DFF',
  longDescription:
    'Integrate Algolia into your workflow. Search indices, manage records (add, update, delete, browse), configure index settings, and perform batch operations.',
  docsLink: 'https://docs.sim.ai/integrations/algolia',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const AlgoliaBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  url: 'https://www.algolia.com',
  templates: [
    {
      icon: AlgoliaIcon,
      title: 'Algolia content indexer',
      prompt:
        'Build a workflow that watches a content source — WordPress, knowledge base — and upserts records into an Algolia index, removing deleted items for accurate search.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia search-quality auditor',
      prompt:
        'Create a scheduled workflow that runs benchmark queries against an Algolia index weekly, scores top-result relevance, and writes a quality report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia settings tuner',
      prompt:
        'Build a workflow that reads an Algolia index settings, has an agent propose improvements to searchable attributes and ranking, and applies the approved settings update.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia index reconciler',
      prompt:
        'Create a workflow that browses all records in an Algolia index, compares them against a source-of-truth table, and batches adds, updates, and deletes to keep the index accurate.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia + knowledge base sync',
      prompt:
        'Build a workflow that mirrors a Sim knowledge base into an Algolia index, keeping vector retrieval and keyword search aligned for hybrid retrieval.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia index inventory',
      prompt:
        'Create a scheduled workflow that lists all Algolia indices and their record counts, writes a daily inventory snapshot to a table, and pings on-call in Slack when an index record count drops unexpectedly.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia stale-record sweeper',
      prompt:
        'Build a scheduled workflow that browses an Algolia index, flags records older than a freshness threshold, writes them to a cleanup table, and deletes the confirmed stale records.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
  ],
  skills: [
    {
      name: 'answer-from-search-index',
      description:
        'Search an Algolia index for a user question and return a grounded answer with the matching records.',
      content:
        '# Answer From Search Index\n\nUse Algolia retrieval to answer questions over indexed content (docs, products, knowledge base).\n\n## Steps\n1. Take the user question and run a search against the relevant Algolia index.\n2. Apply filters or facets to narrow results (category, status, language) when appropriate.\n3. Read the top hits and synthesize an answer grounded only in the returned records.\n4. If no relevant hits are returned, say so rather than guessing.\n\n## Output\nA concise answer plus the titles and IDs of the records used. Do not invent content not present in the hits.',
    },
    {
      name: 'index-new-records',
      description:
        'Take new or updated content and push it into an Algolia index as searchable records.',
      content:
        '# Index New Records\n\nKeep an Algolia index in sync with new content.\n\n## Steps\n1. Collect the source items to index (products, articles, entries).\n2. Map each item to a record object with a stable objectID and the searchable/filterable attributes.\n3. Save the records to the target index, updating existing objectIDs in place.\n4. Verify by running a quick search for one of the new records.\n\n## Output\nReport how many records were added or updated and confirm one is retrievable via search.',
    },
    {
      name: 'audit-search-relevance',
      description:
        'Run a set of test queries against an Algolia index and report which return weak or empty results.',
      content:
        '# Audit Search Relevance\n\nCheck that important queries return good results from an Algolia index.\n\n## Steps\n1. Run each query in the provided test set against the index.\n2. Record the top results, total hit count, and whether the expected record appears.\n3. Flag queries that return zero hits, too many hits, or miss the expected record.\n\n## Output\nA table of queries with result counts and pass/fail, plus suggestions for synonyms or ranking tweaks where relevance is weak.',
    },
  ],
} as const satisfies BlockMeta
