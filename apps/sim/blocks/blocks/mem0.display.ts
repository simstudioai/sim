import { Mem0Icon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const Mem0BlockDisplay = {
  type: 'mem0',
  name: 'Mem0',
  description: 'Agent memory management',
  category: 'tools',
  bgColor: '#181C1E',
  icon: Mem0Icon,
  longDescription: 'Integrate Mem0 into the workflow. Can add, search, and retrieve memories.',
  docsLink: 'https://docs.sim.ai/integrations/mem0',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const Mem0BlockMeta = {
  tags: ['llm', 'knowledge-base', 'agentic'],
  url: 'https://mem0.ai',
  templates: [
    {
      icon: Mem0Icon,
      title: 'Mem0 long-term agent memory',
      prompt:
        'Build an agent that uses Mem0 to remember user preferences and prior conversations across sessions, so follow-up requests reference real history instead of starting from scratch.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 sales-assistant memory',
      prompt:
        'Create a sales agent that persists per-account context in Mem0 — last call notes, open objections, agreed next steps — so every rep starts a follow-up call already up to speed.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 + Zep hybrid memory agent',
      prompt:
        'Create a chat agent that uses Mem0 for persistent user preferences and Zep for in-session continuity, so the agent recalls long-term context while staying coherent turn-to-turn.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['zep'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 + Slack assistant memory',
      prompt:
        'Build a Slack bot that uses Mem0 to remember user preferences and prior conversations, so each follow-up question lands in context instead of starting fresh.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 + Notion personal-knowledge agent',
      prompt:
        'Create an agent that uses Mem0 to recall personal context and Notion as the source-of-truth knowledge base, answering questions with citations plus user-specific memory.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 customer-preference store',
      prompt:
        'Build a workflow that captures customer preferences from support interactions into Mem0 keyed by account, so future automations reference the real preferences.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'crm'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 onboarding-context agent',
      prompt:
        'Create an onboarding agent that adds each new user’s role, goals, and stack to Mem0 on first contact, then searches that memory on every later session so guidance stays tailored to the individual instead of generic.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation', 'onboarding'],
    },
  ],
  skills: [
    {
      name: 'remember-user-context',
      description:
        'Store new facts and preferences for a user in Mem0 from the latest conversation.',
      content:
        '# Remember User Context\n\nPersist what you learned about a user so future sessions stay informed.\n\n## Steps\n1. Identify the user ID this memory belongs to.\n2. Build the messages array from the relevant conversation turns as role and content objects.\n3. Add Memories with the user ID and messages so Mem0 extracts and stores the durable facts.\n\n## Output\nConfirmation the memories were added for the user, with the IDs of the facts created.',
    },
    {
      name: 'recall-relevant-memories',
      description:
        "Search a user's Mem0 memories for the facts relevant to the current request before answering.",
      content:
        '# Recall Relevant Memories\n\nGround a response in what Mem0 already knows about the user.\n\n## Steps\n1. Identify the user ID.\n2. Phrase a search query that captures the current request or topic.\n3. Search Memories with the user ID and query.\n4. Use the returned memories as context when drafting the answer.\n\n## Output\nThe most relevant memories for the user and a note of how they should shape the response.',
    },
    {
      name: 'review-stored-memories',
      description:
        "Retrieve a user's stored Mem0 memories, optionally within a date range, to audit what is known.",
      content:
        "# Review Stored Memories\n\nInspect what Mem0 holds for a user.\n\n## Steps\n1. Identify the user ID.\n2. Get Memories for that user, optionally bounding by a start and end date or a specific memory ID.\n3. Page through results if there are many.\n4. Summarize the stored facts and flag anything stale or contradictory.\n\n## Output\nA readable list of the user's stored memories with a short summary and any items worth updating.",
    },
  ],
} as const satisfies BlockMeta
