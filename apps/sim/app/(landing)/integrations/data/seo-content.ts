/**
 * Per-integration SEO/GEO overrides keyed by integration slug, authored from the
 * SEO team's on-site recommendations. Consumed at render time by the integration
 * page (`integrations/(shell)/[slug]/page.tsx`): both `generateMetadata` (title,
 * description, keywords) and the page body (H1, hero tagline, overview prose, and
 * the triggers/templates/tools section intros).
 *
 * This is NOT baked into `integrations.json` and never touches
 * `scripts/generate-docs.ts`; it augments the generated catalog purely at render
 * time. Any slug absent here renders the generated defaults unchanged. Has no app
 * runtime imports beyond the type, so it stays a cheap, reviewable data source.
 */

import type { IntegrationSeoContent } from '@/app/(landing)/integrations/data/types'

export const INTEGRATION_SEO: Record<string, IntegrationSeoContent> = {
  github: {
    title: 'GitHub Workflow Automation | Sim',
    description:
      'Build GitHub automation in Sim. Use GitHub workflow automation for pull requests, pushes, issues, and releases with AI agents.',
    keywords: ['github automation', 'github workflow automation', 'github integration'],
    h1: 'GitHub Workflow Automation and Integration',
    tagline: 'Build GitHub automation and trigger AI workflows from GitHub events.',
    overview:
      'Use Sim’s GitHub integration to run GitHub automation inside one AI workspace. Get pull request details, post pull request and issue comments, fetch repository and commit data, and trigger workflows from pull requests, comments, pushes, releases, and GitHub Actions events. Build GitHub workflow automation for code reviews, changelog generation, engineering digests, release operations, and documentation updates.',
    triggersIntro:
      'Connect a GitHub webhook to Sim and your agent runs the instant an event happens, no polling, no delay.',
  },
  outlook: {
    title: 'Outlook Automation with Sim',
    description:
      'Build Outlook automation in Sim. Send, draft, route, and manage emails with AI agents using Outlook integration.',
    keywords: ['outlook automation', 'outlook integration'],
    h1: 'Outlook Automation and Integration',
    tagline: 'Build Outlook automation for inboxes, drafts, replies, and email workflows.',
    overview:
      'Integrate Outlook into your workflow and run Outlook automation inside Sim. Send, read, draft, forward, and move email messages, or trigger workflows when new emails arrive. This Outlook integration helps teams automate inbox operations, email routing, follow-ups, and agent-driven communication from one AI workspace.',
    toolsSubtitleSuffix:
      '. Use Sim with Outlook to power Outlook automation for sending, reading, drafting, forwarding, organizing, and triggering email workflows',
  },
  box: {
    title: 'Box Workflow Automation | Box Automation with Sim',
    description:
      'Build Box workflow automation in Sim. Run Box automation for files, folders, search, and Box Sign with AI agents. Free to start.',
    keywords: ['box workflow automation', 'box automation', 'box integration'],
    h1: 'Box Integrations for Workflow Automation',
    tagline: 'Build Box workflow automation for files, folders, and e-signatures.',
    overview:
      'Use Sim’s workflow builder to run Box automation in one AI workspace. This Box integration lets you upload and download files, search content, create folders, send documents for e-signature, track signing status, and connect Box to the rest of your stack with AI agents.',
  },
  slack: {
    title: 'Slack Workflow Automation with Sim',
    description:
      'Build Slack workflow automation in Sim. Send messages, manage channels, and trigger agents with real-time Slack integration.',
    keywords: [
      'slack workflow builder',
      'slack automation',
      'slack workflow automation',
      'slack integration',
    ],
    h1: 'Slack Integrations for Workflow Automation',
    tagline:
      'Build Slack workflow automation in Sim. Send, update, delete, and read messages; manage channels, users, canvases, and modals; and trigger AI agents from mentions, messages, and reactions in real time.',
    overview:
      'Use Sim as your Slack integration for team communication and operations. Build Slack automation that routes requests, posts alerts, summarises threads, updates tickets, and keeps work moving. Sim supports messages, reactions, canvases, views, channel and user lookups, file downloads, and real-time Slack workflows in one workspace.',
    triggersIntro:
      'Connect the Slack Webhook trigger to Sim and run Slack workflow automation the moment a mention, message, or reaction happens, no polling, no delay.',
    templatesIntro:
      'Ready-to-use Slack automation templates for Q&A bots, sales alerts, incident response, standups, digests, and CRM updates. Click any template to launch a workflow faster.',
  },
  airtable: {
    title: 'Airtable Automation with Sim',
    description:
      'Build Airtable workflow automation in Sim. Sync records and run an Airtable integration with AI agents.',
    keywords: ['airtable automation', 'airtable workflow automation', 'airtable ai integration'],
    h1: 'Airtable Workflow Automation and AI Integration',
    tagline: 'Build Airtable automation for records, schema, syncs, and workflow triggers.',
    overview:
      'Use this Airtable integration to run Airtable workflow automation in Sim. List bases and tables, inspect schema, read records, create new rows, update one or many records, and launch workflows when Airtable data changes.',
    triggersIntro:
      'Connect Airtable webhooks to Sim and launch Airtable workflow automation when records are created, updated, or deleted. Pass changed fields into AI agents for enrichment, routing, validation, or notifications.',
    templatesIntro:
      'Start from Airtable automation templates for data sync, enrichment, reporting, and record-driven workflows.',
  },
  pipedrive: {
    title: 'Pipedrive Workflow Automation with Sim',
    description:
      'Build Pipedrive workflow automation in Sim. Run Pipedrive automation for deals, leads, activities, and pipelines.',
    keywords: [
      'pipedrive workflow automation',
      'pipedrive automation',
      'pipedrive integration',
      'pipedrive crm integration',
    ],
    h1: 'Pipedrive Workflow Automation',
    tagline:
      'Build Pipedrive CRM workflow automation for deals, leads, pipelines, activities, files, and mail threads in Sim’s workspace.',
    overview:
      'Use Sim for Pipedrive workflow automation across deals, contacts, leads, sales pipeline stages, projects, activities, files, and communications with powerful CRM capabilities. This Pipedrive integration helps sales teams route leads, update CRM records, trigger follow-ups, and keep pipeline data in sync from one AI workspace.',
    toolsSubtitleSuffix:
      '. Use Sim with Pipedrive for deals, leads, activities, projects, pipelines, files, and mail threads, from creating deals and leads to updating activities, retrieving files, and tracking pipeline progress',
  },
  confluence: {
    title: 'Confluence Workflow Automation with Sim',
    description:
      'Build Confluence workflow automation in Sim. Read, update and trigger pages, comments, spaces and knowledge flows.',
    keywords: ['confluence automation', 'confluence workflow automation'],
    h1: 'Confluence Workflow Automation',
    tagline:
      'Build Confluence automation for pages, comments, attachments, labels and knowledge workflows with AI agents.',
    overview:
      'Integrate Confluence into the workflow with Sim and run Confluence automation across your knowledge base. Read, create, update and delete pages, manage comments, attachments, labels and spaces, search content, and trigger downstream actions the moment Confluence changes.',
    triggersIntro:
      'Connect a Confluence webhook to Sim to start workflows and your agent runs the instant an event happens, no polling, no delay.',
    templatesIntro:
      'Ready-to-use templates for Confluence knowledge workflows. Click any template to build it instantly.',
    toolsSubtitleSuffix:
      ' for Confluence automation across pages, blog posts, comments, attachments, labels, spaces, tasks and users',
  },
  jira: {
    title: 'Jira Automation with Sim',
    description:
      'Build Jira automation in Sim. Create, update, assign, and transition issues with AI agents and real-time triggers.',
    keywords: ['jira automation', 'jira integration'],
    h1: 'Jira Automation with Sim',
    tagline:
      'Build Jira automation for issues, comments, worklogs, and status changes with AI agents and real-time triggers.',
    overview:
      'Integrate Jira into Sim’s workflow and run Jira automation to create, update, assign, and transition issues, search with JQL, manage comments and attachments, and trigger workflows from Jira webhook events. Sim and Jira integration helps teams automate project updates, sprint reporting, triage, and issue routing in one AI workspace.',
    triggersIntro:
      'Connect Jira webhooks to Sim and your agent runs the instant an event, comments, worklogs, sprints, projects, or releases change, no polling, no delay.',
  },
  salesforce: {
    title: 'Salesforce CRM Automation with Sim',
    description:
      'Automate Salesforce CRM with AI agents in Sim. Streamline workflows, sync data, and trigger actions automatically.',
    keywords: ['salesforce automation', 'salesforce workflow automation', 'salesforce integration'],
    h1: 'Salesforce CRM Automation',
    tagline: 'Interact with Salesforce CRM or trigger workflows from Salesforce events.',
    overview:
      'Integrate Salesforce CRM into your workflow. Automate your CRM by managing accounts, contacts, leads, opportunities, cases, and tasks, all with powerful workflow automation. Use Sim’s AI agents to keep your Salesforce data in sync, automate follow-ups, and eliminate manual CRM work.',
    triggersIntro:
      'Connect a Salesforce webhook to Sim and your agent runs the instant an event happens, no polling, no delay. For example, trigger a workflow when a new Salesforce record is created or an opportunity stage changes, and let Sim handle the automation immediately.',
  },
  hubspot: {
    title: 'HubSpot CRM Automation with Sim',
    description:
      'Build HubSpot automation workflows in Sim. Automate CRM updates, triggers, and follow-ups with AI agents. Free to start.',
    keywords: [
      'hubspot automation',
      'hubspot workflow',
      'hubspot automation workflows',
      'hubspot integration',
    ],
    h1: 'HubSpot CRM Automation',
    tagline: 'Build HubSpot automation workflows with AI agents in Sim.',
    overview:
      'Integrate HubSpot into your workflow and run HubSpot automation inside Sim. Create, update, and manage CRM records, or trigger agents and workflows from HubSpot events. This HubSpot integration helps teams automate follow-ups, sync CRM data, and build faster HubSpot automation workflows from one AI workspace.',
    triggersIntro:
      'Sim checks HubSpot on a schedule and runs agents when records are created or updated, so you can automate routing, enrichment, follow-ups, and downstream actions without manual work.',
  },
  notion: {
    title: 'Notion Automation with Sim',
    description:
      'Build Notion automation workflows in Sim. Create, update, and manage Notion pages with AI agents.',
    keywords: ['notion automation', 'notion workflow automation', 'notion integration'],
    h1: 'Notion Automation with Sim',
    tagline: 'Build Notion workflow automation with AI agents in Sim.',
    overview:
      'Integrate Notion into your workflow and run Notion automation inside Sim. Create, update, and manage Notion pages with AI agents, or connect Notion to larger workflows across your stack. This Notion integration helps teams organize knowledge, automate page updates, and build faster Notion workflow automation from one AI workspace.',
  },
  supabase: {
    title: 'Supabase Automation with Sim',
    description:
      'Build Supabase automation in Sim. Connect your database to AI workflows and automate Supabase actions. Free to start.',
    keywords: ['supabase automation', 'supabase integration'],
    h1: 'Supabase Automation',
    tagline: 'Build Supabase automation with AI agents in Sim.',
    overview:
      'Integrate Supabase into your workflow and run Supabase automation inside Sim. Connect your database to AI agents, trigger workflows from app activity, and automate data operations across your stack. This Supabase integration helps teams move faster by connecting backend data, workflows, and AI in one workspace.',
  },
  linkedin: {
    title: 'LinkedIn Automation with Sim',
    description:
      'Build LinkedIn automation workflows in Sim. Share posts, manage your presence, and connect LinkedIn to AI agents. Free to start.',
    keywords: [
      'linkedin automation',
      'linkedin workflow',
      'linkedin workflow automation',
      'linkedin integration',
    ],
    h1: 'LinkedIn Automation',
    tagline: 'Build LinkedIn workflow automation with AI agents in Sim.',
    overview:
      'Integrate LinkedIn into your workflows and run LinkedIn automation inside Sim. Share posts to your personal feed, access LinkedIn profile information, and connect LinkedIn to the rest of your AI workspace. This LinkedIn integration helps teams manage their LinkedIn presence, publish content faster, and build repeatable LinkedIn workflows without manual posting.',
  },
  attio: {
    title: 'Attio Automation with Sim',
    description:
      'Build Attio automation in Sim. Manage CRM records, notes, tasks, lists, comments, and webhooks with AI agents. Free to start.',
    keywords: ['attio automation', 'attio integration'],
    h1: 'Attio Automation',
    tagline:
      'Build Attio automation with AI agents in Sim. Manage records, notes, tasks, lists, comments, and more in Attio CRM.',
    overview:
      'Connect Attio to Sim and run Attio automation across your CRM workflows. Manage records, notes, tasks, lists, list entries, comments, workspace members, and webhooks from one AI workspace. This Attio integration helps teams automate CRM updates, trigger agents from Attio events, and connect customer data to the rest of their go-to-market stack.',
  },
  lemlist: {
    title: 'Lemlist Automation with Sim',
    description:
      'Build Lemlist automation in Sim. Manage outreach activities, leads, replies, and emails with AI agents. Free to start.',
    keywords: ['lemlist automation', 'lemlist integration'],
    h1: 'Lemlist Automation',
    tagline:
      'Build Lemlist automation with AI agents in Sim. Manage outreach activities, leads, replies, and emails through Lemlist.',
    overview:
      'Integrate Lemlist into your workflow and run Lemlist automation inside Sim. Retrieve campaign activities and replies, get lead information, and send emails through the Lemlist inbox. This Lemlist integration helps teams automate outreach workflows, track lead engagement, respond to campaign activity, and connect Lemlist to the rest of their sales and marketing stack.',
  },
  linear: {
    title: 'Linear Automation with Sim',
    description:
      'Build Linear automation in Sim. Manage issues, projects, cycles, comments, and product workflows with AI agents. Free to start.',
    keywords: ['linear automation', 'linear workflow'],
    h1: 'Linear Automation',
    tagline:
      'Build Linear automation with AI agents in Sim. Manage issues, projects, cycles, comments, and product workflows.',
    overview:
      'Integrate Linear into your workflow and run Linear automation inside Sim. Manage issues, comments, projects, labels, workflow states, cycles, attachments, customers, and more from one AI workspace. This Linear workflow setup helps product and engineering teams automate bug triage, issue creation, project updates, sprint reporting, and cross-tool workflows triggered by Linear events.',
  },
  apollo: {
    title: 'Apollo CRM Automation with Sim',
    description:
      'Build Apollo CRM automation in Sim. Search, enrich, manage contacts, and run Apollo.io workflows with AI agents. Free to start.',
    keywords: [
      'apollo crm integration',
      'apollo crm automation',
      'apollo io workflow',
      'apollo io automation',
    ],
    h1: 'Apollo CRM Automation',
    tagline:
      'Build Apollo.io automation with AI agents in Sim. Search, enrich, and manage contacts, accounts, opportunities, and sales workflows.',
    overview:
      'Integrate Apollo into your workflow and run Apollo CRM automation inside Sim. Search for people and companies, enrich contact and account data, manage CRM contacts and accounts, add contacts to sequences, create tasks, and update opportunities from one AI workspace. This Apollo CRM integration helps sales and growth teams automate prospecting, lead enrichment, contact management, and outbound workflows without manual CRM work.',
  },
  datadog: {
    title: 'Datadog Automation with Sim',
    description:
      'Build Datadog workflow automation in Sim. Monitor apps, logs, metrics, incidents, and alerts with AI agents. Free to start.',
    keywords: ['datadog workflow automation', 'datadog automation'],
    h1: 'Datadog Automation',
    tagline:
      'Build Datadog workflow automation in Sim. Monitor apps, logs, metrics, incidents, and alerts with AI agents.',
    overview:
      'Integrate Datadog into your workflow and run Datadog automation inside Sim. Monitor infrastructure, applications, logs, metrics, incidents, dashboards, and alerts from one AI workspace. This Datadog integration helps engineering and operations teams automate observability workflows, investigate issues faster, route incidents, summarize alerts, and connect monitoring data to the rest of their stack.',
  },
}
