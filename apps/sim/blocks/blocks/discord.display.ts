import { DiscordIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DiscordBlockDisplay = {
  type: 'discord',
  name: 'Discord',
  description: 'Interact with Discord',
  category: 'tools',
  bgColor: '#5865F2',
  icon: DiscordIcon,
  iconColor: '#5865F2',
  longDescription:
    'Comprehensive Discord integration: messages, threads, channels, roles, members, invites, and webhooks.',
  docsLink: 'https://docs.sim.ai/integrations/discord',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const DiscordBlockMeta = {
  tags: ['messaging', 'webhooks', 'automation'],
  url: 'https://discord.com',
  templates: [
    {
      icon: DiscordIcon,
      title: 'Discord community manager',
      prompt:
        'Create a knowledge base connected to my Google Docs or Notion with product documentation. Then build a workflow that monitors my Discord server for unanswered questions, answers them using the knowledge base, tracks common questions in a table, and sends a weekly community summary to Slack.',
      modules: ['knowledge-base', 'tables', 'agent', 'scheduled', 'workflows'],
      category: 'support',
      tags: ['community', 'support', 'communication'],
      alsoIntegrations: ['google_docs', 'notion', 'slack'],
    },
    {
      icon: DiscordIcon,
      title: 'Discord support deflector',
      prompt:
        'Build a scheduled workflow that polls help channels in Discord for new questions, searches a knowledge base for an answer, and posts a sourced reply in-thread; escalates to a human when confidence is low.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['community', 'support'],
    },
    {
      icon: DiscordIcon,
      title: 'Discord weekly community digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes Discord activity — top threads, helpful members, new questions — and posts the digest to the announcements channel and Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['community', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DiscordIcon,
      title: 'Discord onboarding tracker',
      prompt:
        'Build a scheduled workflow that polls a Discord server for recently joined members, opens a private onboarding thread for each new member with relevant links, and tracks completion of starter tasks in a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['community', 'automation'],
    },
    {
      icon: DiscordIcon,
      title: 'Discord moderation triage',
      prompt:
        'Create a scheduled workflow that polls Discord channels for new messages, classifies community-guideline violations with an agent, auto-warns the user on minor issues, and pings moderators in a private channel for severe cases.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['community', 'automation'],
    },
    {
      icon: DiscordIcon,
      title: 'Discord feature request collector',
      prompt:
        'Build a scheduled workflow that polls a Discord feedback channel for new posts, classifies them as bugs vs feature requests, opens Linear tickets for actionable items, and replies in-thread with the ticket link.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['community', 'product'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: DiscordIcon,
      title: 'Discord event reminder',
      prompt:
        'Create a scheduled workflow that reads upcoming Luma or Google Calendar events, posts a reminder in the matching Discord channel 24 hours before, and pings RSVP attendees by role.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['community', 'communication'],
      alsoIntegrations: ['luma', 'google_calendar'],
    },
  ],
  skills: [
    {
      name: 'post-announcement',
      description:
        'Post a formatted announcement message to a Discord channel and optionally pin it.',
      content:
        '# Post a Discord Announcement\n\nShare an announcement with a community channel.\n\n## Steps\n1. Confirm the target channel and the announcement content.\n2. Format the message clearly, using mentions or roles only if requested.\n3. Send the message to the channel.\n4. If it is important, pin the message.\n\n## Output\nA confirmation with the channel, message link or id, and whether it was pinned.',
    },
    {
      name: 'summarize-channel-activity',
      description:
        'Read recent Discord channel messages and produce a summary of discussions, questions, and decisions.',
      content:
        '# Summarize Discord Channel Activity\n\nCatch up on what happened in a channel.\n\n## Steps\n1. Confirm the channel and how many recent messages to review.\n2. Get the channel messages.\n3. Group the conversation into themes: announcements, questions, and decisions.\n4. Flag unanswered questions that need a reply.\n\n## Output\nA concise digest of the discussion with unanswered questions called out.',
    },
    {
      name: 'open-discussion-thread',
      description:
        'Create a Discord thread for a topic and post a kickoff message to organize community discussion.',
      content:
        '# Open a Discord Discussion Thread\n\nSpin up a focused thread for a topic.\n\n## Steps\n1. Confirm the parent channel and the thread topic.\n2. Create the thread with a clear name.\n3. Post a kickoff message framing the discussion and any prompts.\n\n## Output\nA confirmation with the thread name, link or id, and the kickoff message posted.',
    },
    {
      name: 'collect-reactions-feedback',
      description:
        'Post a poll-style message in Discord, add reaction options, and read back the tally as feedback.',
      content:
        '# Collect Discord Reaction Feedback\n\nRun a lightweight reaction poll.\n\n## Steps\n1. Confirm the channel, the question, and the reaction options.\n2. Send the poll message.\n3. Add each reaction option to the message.\n4. After the polling window, read the message to tally the reaction counts.\n\n## Output\nThe poll question with the reaction tally and which option leads.',
    },
  ],
} as const satisfies BlockMeta
