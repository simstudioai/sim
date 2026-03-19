/**
 * Curated popular workflow pairs used on both the /integrations listing page
 * and individual /integrations/[slug] pages.
 *
 * Each pair targets specific long-tail search queries like "notion to slack automation".
 * The headline and description are written to be both human-readable and keyword-rich.
 */

export interface WorkflowPair {
  /** Integration name (must match `name` field in integrations.json) */
  from: string
  /** Integration name (must match `name` field in integrations.json) */
  to: string
  headline: string
  description: string
}

export const POPULAR_WORKFLOWS: WorkflowPair[] = [
  {
    from: 'Slack',
    to: 'Notion',
    headline: 'Archive Slack conversations to Notion',
    description:
      'Capture important Slack messages as Notion pages or database entries — ideal for meeting notes, decision logs, and knowledge bases.',
  },
  {
    from: 'Notion',
    to: 'Slack',
    headline: 'Notify your team from Notion',
    description:
      'Post Slack messages automatically when Notion pages are created or updated so the whole team stays aligned without manual check-ins.',
  },
  {
    from: 'GitHub',
    to: 'Jira',
    headline: 'Link GitHub pull requests to Jira tickets',
    description:
      'Transition Jira issues when PRs are opened or merged, keeping your project board accurate without any manual updates.',
  },
  {
    from: 'GitHub',
    to: 'Linear',
    headline: 'Sync GitHub events with Linear issues',
    description:
      'Create Linear issues from GitHub activity, update status on merge, and keep your engineering workflow tightly connected.',
  },
  {
    from: 'Gmail',
    to: 'Notion',
    headline: 'Save incoming emails to Notion databases',
    description:
      'Extract structured data from Gmail and store it in Notion — ideal for lead capture, support tickets, and meeting scheduling.',
  },
  {
    from: 'HubSpot',
    to: 'Slack',
    headline: 'Get HubSpot deal alerts in Slack',
    description:
      'Receive instant Slack notifications when HubSpot deals advance, contacts are created, or revenue milestones are hit.',
  },
  {
    from: 'Google Sheets',
    to: 'Slack',
    headline: 'Send Slack messages from Google Sheets',
    description:
      'Watch a spreadsheet for new rows or changes, then post formatted Slack updates to keep stakeholders informed in real time.',
  },
  {
    from: 'Salesforce',
    to: 'Slack',
    headline: 'Push Salesforce pipeline updates to Slack',
    description:
      'Alert your sales team in Slack when Salesforce opportunities advance, close, or need immediate attention.',
  },
  {
    from: 'Airtable',
    to: 'Gmail',
    headline: 'Trigger Gmail from Airtable records',
    description:
      'Send personalised Gmail messages when Airtable records are created or updated — great for onboarding flows and follow-up sequences.',
  },
  {
    from: 'Linear',
    to: 'Slack',
    headline: 'Linear issue updates in Slack',
    description:
      'Post Slack messages when Linear issues are created, assigned, or completed so your team is always in the loop.',
  },
  {
    from: 'Jira',
    to: 'Confluence',
    headline: 'Auto-generate Confluence pages from Jira sprints',
    description:
      'Create Confluence documentation from Jira sprint data automatically, eliminating manual reporting at the end of every sprint.',
  },
  {
    from: 'Google Sheets',
    to: 'Notion',
    headline: 'Sync Google Sheets data into Notion',
    description:
      'Transform spreadsheet rows into structured Notion database entries for richer documentation and cross-team project tracking.',
  },
  {
    from: 'GitHub',
    to: 'Slack',
    headline: 'Get GitHub activity alerts in Slack',
    description:
      'Post Slack notifications for new PRs, commits, issues, or deployments so your engineering team never misses a critical event.',
  },
  {
    from: 'HubSpot',
    to: 'Gmail',
    headline: 'Send personalised emails from HubSpot events',
    description:
      'Trigger Gmail messages when HubSpot contacts enter a lifecycle stage, ensuring timely and relevant outreach without manual effort.',
  },
]
