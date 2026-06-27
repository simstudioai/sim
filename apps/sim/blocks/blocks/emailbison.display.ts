import { EmailBisonIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const EmailBisonBlockDisplay = {
  type: 'emailbison',
  name: 'Email Bison',
  description: 'Manage Email Bison leads, campaigns, replies, and tags',
  category: 'tools',
  bgColor: '#FB7A22',
  icon: EmailBisonIcon,
  iconColor: '#FB7A22',
  longDescription:
    'Integrate Email Bison into workflows. Create and update leads, manage campaigns, attach leads to campaigns, list replies, and organize leads with tags.',
  docsLink: 'https://docs.sim.ai/integrations/emailbison',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const EmailBisonBlockMeta = {
  tags: ['sales-engagement', 'email-marketing', 'automation'],
  url: 'https://emailbison.com',
  templates: [
    {
      icon: EmailBisonIcon,
      title: 'Email Bison campaign launcher',
      prompt:
        'Build a workflow that takes a target persona and offer, drafts a multi-step Email Bison campaign with personalized variables, creates the campaign and attaches the matching leads, and launches it once a human approves.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'communication'],
    },
    {
      icon: EmailBisonIcon,
      title: 'Email Bison reply triage',
      prompt:
        'Create a workflow that pulls new Email Bison replies on a schedule, classifies each as interested, not interested, objection, or out-of-office, applies the matching tag to the lead, and pings the rep in Slack for hot replies.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EmailBisonIcon,
      title: 'Email Bison + Apollo lead feeder',
      prompt:
        'Build a workflow that runs an Apollo search for an ICP, enriches each prospect, creates the lead in Email Bison with personalization variables, and attaches the leads to the matching active campaign.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: EmailBisonIcon,
      title: 'Email Bison tag automator',
      prompt:
        'Create a workflow that reads Email Bison replies and activity, and applies tags to leads based on engagement signals — opened, clicked, replied positively, bounced — so segmentation stays current for follow-up campaigns.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'analysis'],
    },
    {
      icon: EmailBisonIcon,
      title: 'Email Bison weekly outbound digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Email Bison campaign performance — sends, opens, replies, positive reply rate — generates a digest with the top campaigns and bottom performers, and posts it to a Slack sales channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EmailBisonIcon,
      title: 'Email Bison + HubSpot sync',
      prompt:
        'Create a workflow that mirrors Email Bison lead status and reply outcomes into the matching HubSpot contact, logs each campaign step as an engagement, and creates a HubSpot task for sales when a lead replies positively.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'sync'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: EmailBisonIcon,
      title: 'Email Bison bounce cleanup',
      prompt:
        'Build a scheduled workflow that finds Email Bison leads with hard bounces, tags them for suppression, updates the lead in Email Bison, and writes a cleanup report so deliverability stays healthy.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'add-leads-to-campaign',
      description:
        'Create leads in Email Bison and attach them to an outbound campaign with personalization variables.',
      content:
        '# Add Leads to Campaign\n\nLoad prospects into Email Bison and enroll them in a campaign.\n\n## Steps\n1. Confirm the instance URL and target campaign. If only a campaign name is known, use List Campaigns to resolve its ID.\n2. For each prospect, call Create Lead with first name, last name, email, and any title or company. Pass personalization fields as a custom-variables JSON array (e.g., linkedin_url, first_line).\n3. Collect the new lead IDs and call Attach Leads to Campaign with the campaign ID and those IDs.\n\n## Output\nReport how many leads were created and attached, list any duplicates or invalid emails that were skipped, and confirm the campaign they were added to.',
    },
    {
      name: 'triage-campaign-replies',
      description:
        'Pull recent Email Bison replies, classify each by intent, and tag the lead accordingly.',
      content:
        '# Triage Campaign Replies\n\nProcess inbound replies to outbound campaigns and route them.\n\n## Steps\n1. Call List Replies, optionally scoped to a campaign, sender email, or the inbox folder, and filter to unread when only new replies matter.\n2. Classify each reply as interested, not interested, objection, out-of-office, or auto-reply based on its content.\n3. Resolve or create the matching tag with List Tags / Create Tag, then call Attach Tags to Leads to label the lead by intent.\n\n## Output\nReturn each reply with its lead, classification, and the tag applied. Highlight interested replies so a rep can follow up first.',
    },
    {
      name: 'manage-campaign-status',
      description:
        'Pause, resume, or archive an Email Bison campaign and adjust its sending settings.',
      content:
        '# Manage Campaign Status\n\nControl whether an Email Bison campaign is actively sending and tune its limits.\n\n## Steps\n1. Confirm the campaign ID (resolve via List Campaigns if only a name is given).\n2. Call Update Campaign Status with pause, resume, or archive as requested.\n3. To adjust throughput or behavior, call Update Campaign to change max emails per day, max new leads per day, sequence prioritization, or tracking settings.\n\n## Output\nConfirm the campaign new status and any sending settings that changed. Note the prior values so the change can be reverted if needed.',
    },
    {
      name: 'report-campaign-performance',
      description:
        'Summarize Email Bison campaign performance — sends, opens, replies, and positive reply rate.',
      content:
        '# Report Campaign Performance\n\nProduce a performance snapshot across Email Bison campaigns.\n\n## Steps\n1. Call List Campaigns to get the active campaigns and their stats.\n2. For reply-level detail, call List Replies per campaign and tally interested versus total to compute positive reply rate.\n3. Rank campaigns by reply rate and identify top and bottom performers.\n\n## Output\nReturn a digest: per-campaign sends, opens, replies, and positive reply rate, with the best and worst performers called out and a one-line takeaway for each.',
    },
  ],
} as const satisfies BlockMeta
