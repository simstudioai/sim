import { TrelloIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TrelloBlockDisplay = {
  type: 'trello',
  name: 'Trello',
  description: 'Manage Trello lists, cards, and activity',
  category: 'tools',
  bgColor: '#0052CC',
  icon: TrelloIcon,
  longDescription:
    'Integrate with Trello to list board lists, list cards, create cards, update cards, review activity, and add comments.',
  docsLink: 'https://docs.sim.ai/integrations/trello',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const TrelloBlockMeta = {
  tags: ['project-management', 'ticketing'],
  url: 'https://trello.com',
  templates: [
    {
      icon: TrelloIcon,
      title: 'Trello card auto-router',
      prompt:
        'Build a scheduled workflow that polls a Trello inbox list, classifies each new card by topic, and moves it to the right list based on the classification.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello + Linear bridge',
      prompt:
        'Create a workflow that mirrors Trello cards in a chosen list into Linear issues, keeps status and comments in sync, and writes the link back to the Trello card.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello SLA monitor',
      prompt:
        'Build a workflow that watches Trello cards for due-date breaches, sends reminders, and escalates to managers via Slack when items slip more than 2 days.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello content pipeline',
      prompt:
        'Create a workflow that reads a Trello editorial board, publishes the cards in the "ready" list to WordPress on schedule, and moves the card to "live" with the URL attached.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello weekly digest',
      prompt:
        'Build a scheduled weekly workflow that summarizes Trello board movements — cards completed, blocked, in-progress — and emails the digest to the project owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello stale-card sweeper',
      prompt:
        'Create a scheduled workflow that scans a Trello board for cards with no activity in 30 days, comments a nudge on each, and posts a stale-card list to Slack for the project owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello onboarding seeder',
      prompt:
        'Build a workflow that creates the standard onboarding cards in a Trello list for each new hire, sets due dates by step, and tailors the card set to their role.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
    },
  ],
  skills: [
    {
      name: 'create-card',
      description: 'Create a Trello card in a list with a description, due date, and labels.',
      content:
        '# Create a Trello Card\n\nAdd a new card to a list so work is captured on the right board.\n\n## Steps\n1. Use the Create Card operation and select your Trello account.\n2. Provide the List ID where the card should land and the Card Name.\n3. Add an optional Description, a Due Date (natural language like "next Friday" works), and Label IDs.\n4. Set Position to top or bottom to control where the card appears in the list.\n\n## Output\nReturn the created card including its id, url, and list, so it can be linked or updated later.',
    },
    {
      name: 'triage-and-move-cards',
      description:
        'List cards on a board or list, classify them, and move each to the correct list.',
      content:
        '# Triage and Route Trello Cards\n\nRead incoming cards, decide where each belongs, and route them automatically.\n\n## Steps\n1. Use Get Lists with the Board ID to learn the available lists and their IDs.\n2. Use List Cards with the board or list ID to pull the cards needing triage.\n3. Classify each card by its name and description (topic, priority, owner).\n4. Use Update Card with the Move to List ID to route each card to its destination list.\n\n## Output\nReturn a summary of how many cards were moved and the destination list for each.',
    },
    {
      name: 'comment-on-card',
      description: 'Add a comment to a Trello card to leave a note, nudge, or status update.',
      content:
        '# Comment on a Trello Card\n\nLeave a comment on a card to record context or nudge an owner.\n\n## Steps\n1. Use the Add Comment operation and select your Trello account.\n2. Provide the Card ID of the target card.\n3. Write the Comment text, including any links or mentions the team needs.\n\n## Output\nReturn the created comment action with its id and date so the note can be referenced.',
    },
    {
      name: 'review-card-activity',
      description: 'Pull the recent action history for a Trello board or card and summarize it.',
      content:
        '# Review Trello Card Activity\n\nInspect what has happened recently on a board or card to build a digest or audit.\n\n## Steps\n1. Use the Get Actions operation with either a Board ID or a Card ID (one or the other, not both).\n2. Set an Action Filter such as commentCard,updateCard,createCard to focus on the events you care about.\n3. Use Board Action Limit and Action Page to page through longer histories.\n\n## Output\nReturn the actions with their type, date, author, and text, summarized into a short activity recap.',
    },
  ],
} as const satisfies BlockMeta
