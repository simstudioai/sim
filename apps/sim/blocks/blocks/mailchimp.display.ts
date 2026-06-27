import { Mail } from '@/components/emcn/icons'
import { MailchimpIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MailchimpBlockDisplay = {
  type: 'mailchimp',
  name: 'Mailchimp',
  description: 'Manage audiences, campaigns, and marketing automation in Mailchimp',
  category: 'tools',
  bgColor: '#FFE01B',
  icon: MailchimpIcon,
  longDescription:
    'Integrate Mailchimp into the workflow. Can manage audiences (lists), list members, campaigns, automation workflows, templates, reports, segments, tags, merge fields, interest categories, landing pages, signup forms, and batch operations.',
  docsLink: 'https://docs.sim.ai/integrations/mailchimp',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const MailchimpBlockMeta = {
  tags: ['email-marketing', 'marketing', 'automation'],
  url: 'https://mailchimp.com',
  templates: [
    {
      icon: Mail,
      title: 'Newsletter curator',
      prompt:
        'Create a scheduled weekly workflow that scrapes my favorite industry news sites and blogs, picks the top stories relevant to my audience, writes summaries for each, and drafts a ready-to-send newsletter in Mailchimp.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'communication'],
    },
    {
      icon: MailchimpIcon,
      title: 'Mailchimp re-engagement campaign',
      prompt:
        'Build a workflow that finds Mailchimp members who have not opened or clicked in 90 days, drafts a re-engagement campaign with a personalized subject line per segment, and schedules it to send to those members only.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: MailchimpIcon,
      title: 'Mailchimp + SendGrid hybrid sender',
      prompt:
        'Create a workflow that uses Mailchimp for marketing audience management and segmentation but sends the actual campaign through SendGrid for deliverability, syncing send results, opens, and clicks back to the Mailchimp audience as merge fields.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sync', 'enterprise'],
      alsoIntegrations: ['sendgrid'],
    },
    {
      icon: MailchimpIcon,
      title: 'Mailchimp campaign performance digest',
      prompt:
        'Build a scheduled workflow that pulls the previous week of Mailchimp campaign reports, compares open and click rates against my benchmarks, and posts a Slack digest with the winners, losers, and one-line takeaways.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MailchimpIcon,
      title: 'Mailchimp + Loops audience sync',
      prompt:
        'Create a workflow that keeps a Mailchimp audience and a Loops mailing list in sync: new Mailchimp subscribers create Loops contacts on the matching list, unsubscribes propagate both ways, and merge fields map cleanly to Loops contact properties.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sync', 'automation'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: MailchimpIcon,
      title: 'Mailchimp event-driven blast',
      prompt:
        'Build a workflow that listens for a launch trigger from my tables, populates a Mailchimp campaign template with the launch details, schedules it to the right segment, and logs the campaign ID and recipient count back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: MailchimpIcon,
      title: 'Mailchimp segment builder from HubSpot',
      prompt:
        'Create a workflow that reads HubSpot lifecycle stage and ICP fields, upserts each contact into Mailchimp with the matching tags and merge fields, and recomputes named segments daily so marketing can target by CRM state.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm', 'sync'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'sync-contact-to-audience',
      description: 'Add or update a contact in a Mailchimp audience with merge fields and tags.',
      content:
        '# Sync Contact to Audience\n\nKeep a Mailchimp audience in sync with your source of truth.\n\n## Steps\n1. If the audience is unknown, Get Audiences to find the right list ID.\n2. Use Add or Update Member with the email, subscription status, and merge fields like first and last name.\n3. Apply segmentation with Add Member Tags for lifecycle stage or ICP tags.\n\n## Output\nThe member ID and status in the audience, plus the merge fields and tags applied.',
    },
    {
      name: 'create-and-send-campaign',
      description:
        'Create a Mailchimp campaign, set its content, and send or schedule it to an audience.',
      content:
        '# Create and Send Campaign\n\nLaunch an email campaign to an audience or segment.\n\n## Steps\n1. Create Campaign targeting the audience or a saved segment, with the subject line and from details.\n2. Set Campaign Content with the HTML or a template ID.\n3. Send Campaign immediately, or Schedule Campaign for a future send time.\n\n## Output\nThe campaign ID, the audience or segment targeted, and whether it was sent or scheduled with the send time.',
    },
    {
      name: 'build-targeted-segment',
      description:
        'Create a Mailchimp segment from conditions so a campaign can target a specific slice of an audience.',
      content:
        '# Build Targeted Segment\n\nDefine a reusable audience segment for targeting.\n\n## Steps\n1. Identify the audience and the conditions that define the segment, such as tags, merge field values, or activity.\n2. Create Segment on that audience with the conditions and a clear name.\n3. Optionally Get Segment Members to verify the segment matches the intended contacts.\n\n## Output\nThe segment ID and name, the conditions used, and the count of matching members.',
    },
    {
      name: 'report-campaign-performance',
      description:
        'Pull Mailchimp campaign reports and summarize open, click, and bounce performance.',
      content:
        '# Report Campaign Performance\n\nTurn Mailchimp report data into a readable summary.\n\n## Steps\n1. Get Campaign Reports for the recent window, or Get Campaign Report for a specific campaign ID.\n2. Extract opens, clicks, bounces, and unsubscribes per campaign.\n3. Compute open rate, click rate, and bounce rate and flag campaigns that underperformed.\n\n## Output\nA per-campaign metrics summary with rates and a short list of underperformers worth revisiting.',
    },
  ],
} as const satisfies BlockMeta
