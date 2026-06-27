import { PerplexityIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PerplexityBlockDisplay = {
  type: 'perplexity',
  name: 'Perplexity',
  description: 'Use Perplexity AI for chat and search',
  category: 'tools',
  bgColor: '#20808D',
  icon: PerplexityIcon,
  iconColor: '#20808D',
  longDescription:
    'Integrate Perplexity into the workflow. Can generate completions using Perplexity AI chat models or perform web searches with advanced filtering.',
  docsLink: 'https://docs.sim.ai/integrations/perplexity',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const PerplexityBlockMeta = {
  tags: ['llm', 'web-scraping', 'agentic'],
  url: 'https://www.perplexity.ai',
  templates: [
    {
      icon: PerplexityIcon,
      title: 'Perplexity research briefer',
      prompt:
        'Build an agent that takes a topic or company name, runs deep web research via Perplexity with citations, and saves a structured brief file with sources, key findings, and open questions.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
    {
      icon: PerplexityIcon,
      title: 'Daily news brief via Perplexity',
      prompt:
        'Create a scheduled daily workflow that queries Perplexity for the latest news on topics I follow, summarizes each thread with citations, and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PerplexityIcon,
      title: 'Multi-source research agent',
      prompt:
        'Create an agent that triangulates a topic across Perplexity, Exa, and Tavily, deduplicates findings, and produces a consensus brief with confidence scores per claim.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
      alsoIntegrations: ['exa', 'tavily'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity sales account refresh',
      prompt:
        'Create a scheduled workflow that walks accounts in my CRM, runs Perplexity research on each for new funding, headcount changes, or product launches, and writes the digest back to the account record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity + DSPy structured-output evaluator',
      prompt:
        'Build a workflow that runs DSPy programs against a Perplexity-backed retrieval layer, evaluates outputs with Hugging Face and Mistral parsers, and writes regression scores to a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['dspy', 'huggingface', 'mistral_parse'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity + Hugging Face semantic dedup',
      prompt:
        'Build a workflow that runs Perplexity research, embeds findings with a Hugging Face encoder, deduplicates near-identical claims, and writes a clean research file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
      alsoIntegrations: ['huggingface'],
    },
    {
      icon: PerplexityIcon,
      title: 'Perplexity competitor-watch monitor',
      prompt:
        'Build a scheduled workflow that asks Perplexity for any new launches, pricing changes, or announcements from a list of competitors, summarizes what changed since last run, and posts a cited digest to a Slack channel for the product team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'answer-with-citations',
      description:
        'Ask Perplexity a question and get an answer grounded in current web sources with citations.',
      content:
        '# Answer With Citations\n\nGet a current, sourced answer to a question.\n\n## Steps\n1. Use the Chat operation and write the question as the User Prompt. Add a System Prompt to set tone and require inline citations.\n2. Pick a model: sonar for quick answers, sonar-pro for harder questions, or sonar-deep-research for thorough multi-source work.\n3. Keep temperature low (around 0.2) for factual tasks and set Max Tokens to cap length.\n\n## Output\nThe answer with its supporting sources, and a note flagging anything the model could not confirm.',
    },
    {
      name: 'search-recent-news',
      description:
        'Use Perplexity search with a recency filter to find the latest results on a topic.',
      content:
        '# Search Recent News\n\nFind the freshest sources on a topic.\n\n## Steps\n1. Use the Search operation and enter the topic as the Search Query.\n2. Set a Recency Filter (hour, day, week, month, or year) or pin an After Date and Before Date window.\n3. Optionally constrain a Domain Filter to trusted outlets and set a Country code for regional results.\n4. Adjust Max Results for breadth.\n\n## Output\nA dated list of results, each with title, URL, and a one-line summary, ordered by relevance and recency.',
    },
    {
      name: 'domain-restricted-research',
      description:
        'Run a Perplexity search restricted to specific authoritative domains and summarize findings.',
      content:
        '# Domain-Restricted Research\n\nResearch a topic using only trusted sources.\n\n## Steps\n1. Use the Search operation with a precise Search Query.\n2. Set the Domain Filter to the allowed domains (comma-separated, up to twenty) such as official, academic, or .gov sites.\n3. Tune Max Page Tokens to control how much text is pulled per source.\n4. Synthesize the returned results into a short summary.\n\n## Output\nA concise summary drawn only from the allowed domains, with each finding attributed to its source URL.',
    },
  ],
} as const satisfies BlockMeta
