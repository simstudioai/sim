import { ZepIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ZepBlockDisplay = {
  type: 'zep',
  name: 'Zep',
  description: 'Long-term memory for AI agents',
  category: 'tools',
  bgColor: '#E8E8E8',
  icon: ZepIcon,
  longDescription:
    'Integrate Zep for long-term memory management. Create threads, add messages, retrieve context with AI-powered summaries and facts extraction.',
  docsLink: 'https://docs.sim.ai/integrations/zep',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const ZepBlockMeta = {
  tags: ['knowledge-base', 'agentic'],
  url: 'https://www.getzep.com',
  templates: [
    {
      icon: ZepIcon,
      title: 'Zep session memory for chat',
      prompt:
        'Create a chat agent that stores every turn in Zep with user metadata, retrieves the most relevant prior context on each new question, and answers with continuity instead of forgetting.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
    },
    {
      icon: ZepIcon,
      title: 'Zep + knowledge base support bot',
      prompt:
        'Build a support agent that combines Zep session memory with a knowledge base, so it remembers what the customer has already tried while still grounding answers in product docs.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: ZepIcon,
      title: 'Zep + Salesforce account memory',
      prompt:
        'Build a workflow that for each Salesforce account writes meeting and email context into Zep keyed by account, so any future agent interaction has full history.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ZepIcon,
      title: 'Zep + Intercom support continuity',
      prompt:
        'Create a Zep-backed support agent for Intercom that remembers what each customer has tried before, prefers, or escalated, so support conversations never restart from scratch.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['intercom'],
    },
    {
      icon: ZepIcon,
      title: 'Zep evaluation harness',
      prompt:
        'Build a scheduled workflow that evaluates Zep memory recall accuracy weekly against a labeled eval set, captures regressions, and writes a quality report.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: ZepIcon,
      title: 'Zep personal-assistant memory',
      prompt:
        'Create a personal assistant agent that records preferences, recurring tasks, and prior decisions in Zep, then retrieves the relevant facts on each request so it stays consistent across days instead of asking the same questions again.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: ZepIcon,
      title: 'Zep + Slack team-context bot',
      prompt:
        'Build a Slack bot that stores each conversation in Zep keyed by channel and user, retrieves the relevant prior context when someone asks a follow-up, and answers in thread with continuity across the whole team’s history.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'persist-conversation-turn',
      description:
        'Record the latest user and agent messages into a Zep thread so memory builds over time.',
      content:
        '# Persist a Conversation Turn in Zep\n\nSave each exchange so the agent remembers it later.\n\n## Steps\n1. Ensure a user exists for the person, adding the user if this is their first interaction.\n2. Ensure a thread exists for this conversation, creating one if needed and tying it to the user.\n3. Add the latest messages to the thread, tagging roles as user or assistant.\n4. Confirm the messages were stored.\n\n## Output\nReturn the thread ID and user ID used, and confirm how many messages were added. These IDs are reused on the next turn.',
    },
    {
      name: 'recall-user-context',
      description:
        'Fetch the assembled memory context for a Zep thread to ground the next agent response.',
      content:
        '# Recall User Context from Zep\n\nPull relevant long-term memory before the agent replies.\n\n## Steps\n1. Identify the thread for the current conversation, and the user behind it.\n2. Call get-context for the thread, choosing summary mode for natural language or basic mode for raw facts.\n3. Use the returned context block to inform the next response, since it spans all of this user prior threads.\n\n## Output\nReturn the context block as relevant facts and history about the user. Note the thread and user it was drawn from, and feed it into the agent prompt rather than echoing it to the user.',
    },
    {
      name: 'review-user-memory',
      description:
        'List a user threads and messages in Zep to inspect what the agent remembers about them.',
      content:
        '# Review What Zep Remembers\n\nInspect the stored memory for a user.\n\n## Steps\n1. Get the user to confirm they exist and read their profile.\n2. Get the user threads to see every conversation tied to them.\n3. Get messages from a thread of interest to read the stored history.\n\n## Output\nReturn a summary of the user threads with counts and key facts surfaced, plus the messages from any thread inspected. Cite the user ID and thread IDs.',
    },
  ],
} as const satisfies BlockMeta
