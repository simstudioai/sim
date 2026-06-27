import { MicrosoftTeamsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MicrosoftTeamsBlockDisplay = {
  type: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Manage messages, reactions, and members in Teams',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftTeamsIcon,
  longDescription:
    'Integrate Microsoft Teams into the workflow. Read, write, update, and delete chat and channel messages. Reply to messages, add reactions, and list team/channel members. Can be used in trigger mode to trigger a workflow when a message is sent to a chat or channel. To mention users in messages, wrap their name in `<at>` tags: `<at>userName</at>`',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_teams',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay

export const MicrosoftTeamsBlockMeta = {
  tags: ['messaging', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-teams/group-chat-software',
  templates: [
    {
      icon: MicrosoftTeamsIcon,
      title: 'Microsoft Teams daily brief',
      prompt:
        'Build a scheduled workflow that pulls updates from your project tools — GitHub commits, Jira ticket status changes, and calendar events — and posts a formatted daily brief to your Microsoft Teams channel each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting', 'enterprise'],
      alsoIntegrations: ['github', 'jira'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams incident war room',
      prompt:
        'Build a workflow triggered by a PagerDuty incident that creates a Microsoft Teams war-room channel, invites responders, posts the incident summary, and keeps the channel name in sync with incident state.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams sales-deal channel',
      prompt:
        'Create a workflow that listens for new Salesforce opportunities above a threshold, creates a Microsoft Teams channel for the deal, invites the account team, and pins the opportunity link.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enterprise'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams approval router',
      prompt:
        'Build a workflow that posts approval requests with quick-action buttons in Microsoft Teams, captures the decision, writes it back to the source record, and notifies the requester.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams weekly metrics digest',
      prompt:
        'Create a scheduled weekly workflow that aggregates key business metrics from Stripe and HubSpot, formats them into a polished Microsoft Teams adaptive card, and posts to the leadership channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['stripe', 'hubspot'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams onboarding bot',
      prompt:
        'Build a Microsoft Teams bot that greets new hires when added to the org, walks them through onboarding tasks with progress checkboxes, and writes completion status to an HR table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
    },
    {
      icon: MicrosoftTeamsIcon,
      title: 'Teams ticket-bridge for Zendesk',
      prompt:
        'Create a workflow that mirrors high-priority Zendesk tickets into Microsoft Teams channels, keeps replies synced both ways, and closes the Teams thread when the ticket is resolved.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'enterprise'],
      alsoIntegrations: ['zendesk'],
    },
  ],
  skills: [
    {
      name: 'post-channel-announcement',
      description: 'Write a formatted message to a specific Microsoft Teams channel.',
      content:
        '# Post Channel Announcement\n\nSend an announcement or update to a Microsoft Teams channel.\n\n## Steps\n1. Identify the team and channel to post to, selecting the channel id.\n2. Compose the message body, using clear headings and bullets so it reads well in Teams.\n3. Run Write Channel Message with the channel id and the formatted content.\n4. If a thread already exists for the topic, use Reply to Channel Message instead to keep context together.\n\n## Output\nConfirm the posted message id and channel. Quote the first line of what was posted.',
    },
    {
      name: 'summarize-channel-activity',
      description:
        'Read recent Microsoft Teams channel messages and produce a concise digest of decisions and action items.',
      content:
        '# Summarize Channel Activity\n\nTurn a busy Microsoft Teams channel into a short readable digest.\n\n## Steps\n1. Run Read Channel Messages for the target channel.\n2. Group messages by topic or thread and drop noise such as greetings and reactions.\n3. Extract decisions made, open questions, and any explicit action items with owners.\n4. Optionally post the digest back to the channel as a new message.\n\n## Output\nThree short sections: Decisions, Open Questions, Action Items. Each item one line with the person responsible when known.',
    },
    {
      name: 'acknowledge-with-reaction',
      description: 'React to a specific Microsoft Teams message to acknowledge it.',
      content:
        '# Acknowledge with Reaction\n\nAdd or remove an emoji reaction on a Microsoft Teams message.\n\n## Steps\n1. Locate the message using Get Message or the known message id and channel/chat id.\n2. Run Add Reaction with the desired reactionType to acknowledge or signal status.\n3. Use Remove Reaction when the acknowledgment should be cleared.\n\n## Output\nConfirm the reaction applied and on which message. Keep the response to one line.',
    },
    {
      name: 'list-team-members',
      description: 'List the members of a Microsoft Teams team or channel for routing or auditing.',
      content:
        '# List Team Members\n\nRetrieve who belongs to a Microsoft Teams team or channel.\n\n## Steps\n1. Decide whether you need team-wide membership or a single channel and pick List Team Members or List Channel Members.\n2. Run the operation with the team id (and channel id when needed).\n3. Normalize the result into a clean roster of names and roles.\n\n## Output\nA roster list with display name and role. Note the total count at the top.',
    },
  ],
} as const satisfies BlockMeta
