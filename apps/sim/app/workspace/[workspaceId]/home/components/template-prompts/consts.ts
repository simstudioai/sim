import type { ComponentType, SVGProps } from 'react'
import {
  BookOpen,
  Bug,
  Calendar,
  Card,
  ClipboardList,
  DocumentAttachment,
  File,
  FolderCode,
  Hammer,
  Integration,
  Layout,
  Mail,
  Pencil,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Table,
  Users,
  Wrench,
} from '@/components/emcn/icons'
import {
  AirtableIcon,
  AmplitudeIcon,
  ApolloIcon,
  CalendlyIcon,
  ConfluenceIcon,
  DatadogIcon,
  DiscordIcon,
  FirecrawlIcon,
  GithubIcon,
  GmailIcon,
  GongIcon,
  GoogleCalendarIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
  GreenhouseIcon,
  HubspotIcon,
  IntercomIcon,
  JiraIcon,
  LemlistIcon,
  LinearIcon,
  LinkedInIcon,
  MicrosoftTeamsIcon,
  NotionIcon,
  PagerDutyIcon,
  RedditIcon,
  SalesforceIcon,
  ShopifyIcon,
  SlackIcon,
  StripeIcon,
  TwilioIcon,
  TypeformIcon,
  WebflowIcon,
  WordpressIcon,
  YouTubeIcon,
  ZendeskIcon,
} from '@/components/icons'
import { MarkdownIcon } from '@/components/icons/document-icons'

/**
 * Modules that a template leverages.
 * Used to show pill badges so users understand what platform features are involved.
 */
export const MODULE_META = {
  'knowledge-base': { label: 'Knowledge Base' },
  tables: { label: 'Tables' },
  files: { label: 'Files' },
  workflows: { label: 'Workflows' },
  scheduled: { label: 'Scheduled Tasks' },
  agent: { label: 'Agent' },
} as const

export type ModuleTag = keyof typeof MODULE_META

/**
 * Categories for grouping templates in the UI.
 */
export const CATEGORY_META = {
  popular: { label: 'Popular' },
  sales: { label: 'Sales & CRM' },
  support: { label: 'Support' },
  engineering: { label: 'Engineering' },
  marketing: { label: 'Marketing & Content' },
  productivity: { label: 'Productivity' },
  operations: { label: 'Operations' },
} as const

export type Category = keyof typeof CATEGORY_META

/**
 * Freeform tags for cross-cutting concerns that don't fit neatly into a single category.
 * Use these to filter templates by persona, pattern, or domain in the future.
 *
 * Persona tags: founder, sales, engineering, marketing, support, hr, finance, product, community, devops
 * Pattern tags: monitoring, reporting, automation, research, sync, communication, analysis
 * Domain tags: ecommerce, legal, recruiting, infrastructure, content, crm
 */
export type Tag = string

export interface TemplatePrompt {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  prompt: string
  image?: string
  modules: ModuleTag[]
  category: Category
  tags: Tag[]
  featured?: boolean
}

/**
 * To add a new template:
 * 1. Add an entry to this array with the required fields.
 * 2. Set `featured: true` if it should appear in the initial grid.
 * 3. Optionally add a screenshot to `/public/templates/` and reference it in `image`.
 * 4. Add relevant `tags` for cross-cutting filtering (persona, pattern, domain).
 */
export const TEMPLATES: TemplatePrompt[] = [
  // ── Popular / Featured ──────────────────────────────────────────────────
  {
    icon: Table,
    title: 'Self-populating CRM',
    prompt:
      'Create a self-healing CRM table that keeps track of all my customers by integrating with my existing data sources. Schedule a recurring job every morning to automatically pull updates from all relevant data sources and keep my CRM up to date.',
    image: '/templates/crm-light.png',
    modules: ['tables', 'scheduled', 'workflows'],
    category: 'popular',
    tags: ['founder', 'sales', 'crm', 'sync', 'automation'],
    featured: true,
  },
  {
    icon: GoogleCalendarIcon,
    title: 'Meeting prep agent',
    prompt:
      'Create an agent that checks my Google Calendar each morning, researches every attendee and topic on the web, and prepares a brief for each meeting so I walk in fully prepared. Schedule it to run every weekday morning.',
    image: '/templates/meeting-prep-dark.png',
    modules: ['agent', 'scheduled', 'workflows'],
    category: 'popular',
    tags: ['founder', 'sales', 'research', 'automation'],
    featured: true,
  },
  {
    icon: MarkdownIcon,
    title: 'Resolve todo list',
    prompt:
      'Create a file of all my todos then go one by one and check off every time a todo is done. Look at my calendar and see what I have to do.',
    image: '/templates/todo-list-light.png',
    modules: ['files', 'agent', 'workflows'],
    category: 'popular',
    tags: ['individual', 'automation'],
    featured: true,
  },
  {
    icon: Search,
    title: 'Research assistant',
    prompt:
      'Build an agent that takes a topic, searches the web for the latest information, summarizes key findings, and compiles them into a clean document I can review.',
    image: '/templates/research-assistant-dark.png',
    modules: ['agent', 'files', 'workflows'],
    category: 'popular',
    tags: ['founder', 'research', 'content', 'individual'],
    featured: true,
  },
  {
    icon: GmailIcon,
    title: 'Auto-reply agent',
    prompt:
      'Create a workflow that reads my Gmail inbox, identifies emails that need a response, and drafts contextual replies for each one. Schedule it to run every hour.',
    image: '/templates/gmail-agent-dark.png',
    modules: ['agent', 'workflows'],
    category: 'popular',
    tags: ['individual', 'communication', 'automation'],
    featured: true,
  },
  {
    icon: Table,
    title: 'Expense tracker',
    prompt:
      'Create a table that tracks all my expenses by pulling transactions from my connected accounts. Categorize each expense automatically and generate a weekly summary report.',
    image: '/templates/expense-tracker-light.png',
    modules: ['tables', 'scheduled', 'workflows'],
    category: 'popular',
    tags: ['finance', 'individual', 'reporting'],
    featured: true,
  },

  // ── Sales & CRM ────────────────────────────────────────────────────────
  {
    icon: FolderCode,
    title: 'RFP and proposal drafter',
    prompt:
      'Create a knowledge base from my past proposals, case studies, and company information. Then build an agent that drafts responses to new RFPs by matching requirements to relevant past work, generating tailored sections, and compiling a complete proposal file.',
    modules: ['knowledge-base', 'files', 'agent'],
    category: 'sales',
    tags: ['sales', 'content', 'enterprise'],
  },
  {
    icon: File,
    title: 'Competitive battle cards',
    prompt:
      'Create an agent that deep-researches each of my competitors using web search — their product features, pricing, positioning, strengths, and weaknesses — and generates a structured battle card document for each one that my sales team can reference during calls.',
    modules: ['agent', 'files', 'workflows'],
    category: 'sales',
    tags: ['sales', 'research', 'content'],
  },
  {
    icon: ClipboardList,
    title: 'QBR prep agent',
    prompt:
      'Build a workflow that compiles everything needed for a quarterly business review — pulling customer usage data, support ticket history, billing summary, and key milestones from my tables — and generates a polished QBR document ready to present.',
    modules: ['tables', 'files', 'agent', 'workflows'],
    category: 'sales',
    tags: ['sales', 'support', 'reporting'],
  },
  {
    icon: SalesforceIcon,
    title: 'CRM knowledge search',
    prompt:
      'Create a knowledge base connected to my Salesforce account so all deals, contacts, notes, and activities are automatically synced and searchable. Then build an agent I can ask things like "what\'s the history with Acme Corp?" or "who was involved in the last enterprise deal?" and get instant answers with CRM record citations.',
    modules: ['knowledge-base', 'agent'],
    category: 'sales',
    tags: ['sales', 'crm', 'research'],
  },
  {
    icon: HubspotIcon,
    title: 'HubSpot deal search',
    prompt:
      'Create a knowledge base connected to my HubSpot account so all deals, contacts, and activity history are automatically synced and searchable. Then build an agent I can ask things like "what happened with the Stripe integration deal?" or "which deals closed last quarter over $50k?" and get answers with HubSpot record links.',
    modules: ['knowledge-base', 'agent'],
    category: 'sales',
    tags: ['sales', 'crm', 'research'],
  },
  {
    icon: Users,
    title: 'Lead enrichment pipeline',
    prompt:
      'Build a workflow that watches my leads table for new entries, enriches each lead with company size, funding, tech stack, and decision-maker contacts using Apollo and web search, then updates the table with the enriched information.',
    modules: ['tables', 'agent', 'workflows'],
    category: 'sales',
    tags: ['sales', 'crm', 'automation', 'research'],
  },
  {
    icon: ApolloIcon,
    title: 'Prospect researcher',
    prompt:
      'Create an agent that takes a company name, deep-researches them across the web, finds key decision-makers, recent news, funding rounds, and pain points, then compiles a prospect brief I can review before outreach.',
    modules: ['agent', 'files', 'workflows'],
    category: 'sales',
    tags: ['sales', 'research'],
  },
  {
    icon: LemlistIcon,
    title: 'Outbound sequence builder',
    prompt:
      'Build a workflow that reads leads from my table, researches each prospect and their company on the web, writes a personalized cold email tailored to their role and pain points, and sends it via Gmail. Schedule it to run daily to process new leads automatically.',
    modules: ['tables', 'agent', 'workflows'],
    category: 'sales',
    tags: ['sales', 'communication', 'automation'],
  },
  {
    icon: SalesforceIcon,
    title: 'Deal pipeline tracker',
    prompt:
      'Create a table with columns for deal name, stage, amount, close date, and next steps. Build a workflow that syncs open deals from Salesforce into this table daily, and sends me a Slack summary each morning of deals that need attention or are at risk of slipping.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'sales',
    tags: ['sales', 'crm', 'monitoring', 'reporting'],
  },
  {
    icon: HubspotIcon,
    title: 'Win/loss analyzer',
    prompt:
      'Build a workflow that pulls closed deals from HubSpot each week, analyzes patterns in wins vs losses — deal size, industry, sales cycle length, objections — and generates a report file with actionable insights on what to change. Schedule it to run every Monday.',
    modules: ['agent', 'files', 'scheduled', 'workflows'],
    category: 'sales',
    tags: ['sales', 'crm', 'analysis', 'reporting'],
  },
  {
    icon: GongIcon,
    title: 'Sales call analyzer',
    prompt:
      'Build a workflow that pulls call transcripts from Gong after each sales call, identifies key objections raised, action items promised, and competitor mentions, updates the deal record in my CRM, and posts a call summary with next steps to the Slack deal channel.',
    modules: ['agent', 'tables', 'workflows'],
    category: 'sales',
    tags: ['sales', 'analysis', 'communication'],
  },
  {
    icon: WebflowIcon,
    title: 'Webflow lead capture pipeline',
    prompt:
      'Create a workflow that monitors new Webflow form submissions, enriches each lead with company and contact data using Apollo and web search, adds them to a tracking table with a lead score, and sends a Slack notification to the sales team for high-potential leads.',
    modules: ['tables', 'agent', 'workflows'],
    category: 'sales',
    tags: ['sales', 'crm', 'automation'],
  },

  // ── Support ─────────────────────────────────────────────────────────────
  {
    icon: Send,
    title: 'Customer support bot',
    prompt:
      'Create a knowledge base and connect it to my Notion or Google Docs so it stays synced with my product documentation automatically. Then build an agent that answers customer questions using it with sourced citations and deploy it as a chat endpoint.',
    modules: ['knowledge-base', 'agent', 'workflows'],
    category: 'support',
    tags: ['support', 'communication', 'automation'],
  },
  {
    icon: SlackIcon,
    title: 'Slack Q&A bot',
    prompt:
      'Create a knowledge base connected to my Notion workspace so it stays synced with my company wiki. Then build a workflow that monitors Slack channels for questions and answers them using the knowledge base with source citations.',
    modules: ['knowledge-base', 'agent', 'workflows'],
    category: 'support',
    tags: ['support', 'communication', 'team'],
  },
  {
    icon: IntercomIcon,
    title: 'Customer feedback analyzer',
    prompt:
      'Build a scheduled workflow that pulls support tickets and conversations from Intercom daily, categorizes them by theme and sentiment, tracks trends in a table, and sends a weekly Slack report highlighting the top feature requests and pain points.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'support',
    tags: ['support', 'product', 'analysis', 'reporting'],
  },
  {
    icon: Table,
    title: 'Churn risk detector',
    prompt:
      'Create a workflow that monitors customer activity — support ticket frequency, response sentiment, usage patterns — scores each account for churn risk in a table, and triggers a Slack alert to the account team when a customer crosses the risk threshold.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'support',
    tags: ['support', 'sales', 'monitoring', 'analysis'],
  },
  {
    icon: DiscordIcon,
    title: 'Discord community manager',
    prompt:
      'Create a knowledge base connected to my Google Docs or Notion with product documentation. Then build a workflow that monitors my Discord server for unanswered questions, answers them using the knowledge base, tracks common questions in a table, and sends a weekly community summary to Slack.',
    modules: ['knowledge-base', 'tables', 'agent', 'scheduled', 'workflows'],
    category: 'support',
    tags: ['community', 'support', 'communication'],
  },
  {
    icon: TypeformIcon,
    title: 'Survey response analyzer',
    prompt:
      'Create a workflow that pulls new Typeform responses daily, categorizes feedback by theme and sentiment, logs structured results to a table, and sends a Slack digest when a new batch of responses comes in with the key takeaways.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'support',
    tags: ['product', 'analysis', 'reporting'],
  },
  {
    icon: GmailIcon,
    title: 'Email knowledge search',
    prompt:
      'Create a knowledge base connected to my Gmail so all my emails are automatically synced, chunked, and searchable. Then build an agent I can ask things like "what did Sarah say about the pricing proposal?" or "find the contract John sent last month" and get instant answers with the original email cited.',
    modules: ['knowledge-base', 'agent'],
    category: 'support',
    tags: ['individual', 'research', 'communication'],
  },
  {
    icon: ZendeskIcon,
    title: 'Support ticket knowledge search',
    prompt:
      'Create a knowledge base connected to my Zendesk account so all past tickets, resolutions, and agent notes are automatically synced and searchable. Then build an agent my support team can ask things like "how do we usually resolve the SSO login issue?" or "has anyone reported this billing bug before?" to find past solutions instantly.',
    modules: ['knowledge-base', 'agent'],
    category: 'support',
    tags: ['support', 'research', 'team'],
  },

  // ── Engineering ─────────────────────────────────────────────────────────
  {
    icon: Wrench,
    title: 'Feature spec writer',
    prompt:
      'Create an agent that takes a rough feature idea or user story, researches how similar features work in competing products, and writes a complete product requirements document with user stories, acceptance criteria, edge cases, and technical considerations.',
    modules: ['agent', 'files', 'workflows'],
    category: 'engineering',
    tags: ['product', 'engineering', 'research', 'content'],
  },
  {
    icon: JiraIcon,
    title: 'Jira knowledge search',
    prompt:
      'Create a knowledge base connected to my Jira project so all tickets, comments, and resolutions are automatically synced and searchable. Then build an agent I can ask things like "how did we fix the auth timeout issue?" or "what was decided about the API redesign?" and get answers with ticket citations.',
    modules: ['knowledge-base', 'agent'],
    category: 'engineering',
    tags: ['engineering', 'research'],
  },
  {
    icon: LinearIcon,
    title: 'Linear knowledge search',
    prompt:
      'Create a knowledge base connected to my Linear workspace so all issues, comments, project updates, and decisions are automatically synced and searchable. Then build an agent I can ask things like "why did we deprioritize the mobile app?" or "what was the root cause of the checkout bug?" and get answers traced back to specific issues.',
    modules: ['knowledge-base', 'agent'],
    category: 'engineering',
    tags: ['engineering', 'research', 'product'],
  },
  {
    icon: Bug,
    title: 'Bug triage agent',
    prompt:
      'Build an agent that monitors Sentry for new errors, automatically triages them by severity and affected users, creates Linear tickets for critical issues with full stack traces, and sends a Slack notification to the on-call channel.',
    modules: ['agent', 'workflows'],
    category: 'engineering',
    tags: ['engineering', 'devops', 'automation'],
  },
  {
    icon: GithubIcon,
    title: 'PR review assistant',
    prompt:
      'Create a knowledge base connected to my GitHub repo so it stays synced with my style guide and coding standards. Then build a workflow that reviews new pull requests against it, checks for common issues and security vulnerabilities, and posts a review comment with specific suggestions.',
    modules: ['knowledge-base', 'agent', 'workflows'],
    category: 'engineering',
    tags: ['engineering', 'automation'],
  },
  {
    icon: GithubIcon,
    title: 'Changelog generator',
    prompt:
      'Build a scheduled workflow that runs every Friday, pulls all merged PRs from GitHub for the week, categorizes changes as features, fixes, or improvements, and generates a user-facing changelog document with clear descriptions.',
    modules: ['scheduled', 'agent', 'files', 'workflows'],
    category: 'engineering',
    tags: ['engineering', 'product', 'reporting', 'content'],
  },
  {
    icon: LinearIcon,
    title: 'Incident postmortem writer',
    prompt:
      'Create a workflow that when triggered after an incident, pulls the Slack thread from the incident channel, gathers relevant Sentry errors and deployment logs, and drafts a structured postmortem with timeline, root cause, and action items.',
    modules: ['agent', 'files', 'workflows'],
    category: 'engineering',
    tags: ['engineering', 'devops', 'analysis'],
  },
  {
    icon: NotionIcon,
    title: 'Documentation auto-updater',
    prompt:
      'Create a knowledge base connected to my GitHub repository so code and docs stay synced. Then build a scheduled weekly workflow that detects API changes, compares them against the knowledge base to find outdated documentation, and either updates Notion pages directly or creates Linear tickets for the needed changes.',
    modules: ['scheduled', 'agent', 'workflows'],
    category: 'engineering',
    tags: ['engineering', 'sync', 'automation'],
  },
  {
    icon: PagerDutyIcon,
    title: 'Incident response coordinator',
    prompt:
      'Create a knowledge base connected to my Confluence or Notion with runbooks and incident procedures. Then build a workflow triggered by PagerDuty incidents that searches the runbooks, gathers related Datadog alerts, identifies the on-call rotation, and posts a comprehensive incident brief to Slack.',
    modules: ['knowledge-base', 'agent', 'workflows'],
    category: 'engineering',
    tags: ['devops', 'engineering', 'automation'],
  },
  {
    icon: JiraIcon,
    title: 'Sprint report generator',
    prompt:
      'Create a scheduled workflow that runs at the end of each sprint, pulls all completed, in-progress, and blocked Jira tickets, calculates velocity and carry-over, and generates a sprint summary document with charts and trends to share with the team.',
    modules: ['scheduled', 'agent', 'files', 'workflows'],
    category: 'engineering',
    tags: ['engineering', 'reporting', 'team'],
  },
  {
    icon: ConfluenceIcon,
    title: 'Knowledge base sync',
    prompt:
      'Create a knowledge base connected to my Confluence workspace so all wiki pages are automatically synced and searchable. Then build a scheduled workflow that identifies stale pages not updated in 90 days and sends a Slack reminder to page owners to review them.',
    modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
    category: 'engineering',
    tags: ['engineering', 'sync', 'team'],
  },

  // ── Marketing & Content ─────────────────────────────────────────────────
  {
    icon: Pencil,
    title: 'Long-form content writer',
    prompt:
      'Build a workflow that takes a topic or brief, researches it deeply across the web, generates a detailed outline, then writes a full long-form article with sections, examples, and a conclusion. Save the final draft as a document for review.',
    modules: ['agent', 'files', 'workflows'],
    category: 'marketing',
    tags: ['content', 'research', 'marketing'],
  },
  {
    icon: Layout,
    title: 'Case study generator',
    prompt:
      'Create a knowledge base from my customer data and interview notes, then build a workflow that generates a polished case study file with the challenge, solution, results, and a pull quote — formatted and ready to publish.',
    modules: ['knowledge-base', 'files', 'agent'],
    category: 'marketing',
    tags: ['marketing', 'content', 'sales'],
  },
  {
    icon: Table,
    title: 'Social media content calendar',
    prompt:
      'Build a workflow that generates a full month of social media content for my brand. Research trending topics in my industry, create a table with post dates, platforms, copy drafts, and hashtags, then schedule a weekly refresh to keep the calendar filled with fresh ideas.',
    modules: ['tables', 'agent', 'scheduled', 'workflows'],
    category: 'marketing',
    tags: ['marketing', 'content', 'automation'],
  },
  {
    icon: Integration,
    title: 'Multi-language content translator',
    prompt:
      'Create a workflow that takes a document or blog post and translates it into multiple target languages while preserving tone, formatting, and brand voice. Save each translation as a separate file and flag sections that may need human review for cultural nuance.',
    modules: ['files', 'agent', 'workflows'],
    category: 'marketing',
    tags: ['content', 'enterprise', 'automation'],
  },
  {
    icon: YouTubeIcon,
    title: 'Content repurposer',
    prompt:
      'Build a workflow that takes a YouTube video URL, pulls the video details and description, researches the topic on the web for additional context, and generates a Twitter thread, LinkedIn post, and blog summary optimized for each platform.',
    modules: ['agent', 'files', 'workflows'],
    category: 'marketing',
    tags: ['marketing', 'content', 'automation'],
  },
  {
    icon: RedditIcon,
    title: 'Social mention tracker',
    prompt:
      'Create a scheduled workflow that monitors Reddit and X for mentions of my brand and competitors, scores each mention by sentiment and reach, logs them to a table, and sends a daily Slack digest of notable mentions.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'marketing',
    tags: ['marketing', 'monitoring', 'analysis'],
  },
  {
    icon: FirecrawlIcon,
    title: 'SEO content brief generator',
    prompt:
      'Build a workflow that takes a target keyword, scrapes the top 10 ranking pages, analyzes their content structure and subtopics, then generates a detailed content brief with outline, word count target, questions to answer, and internal linking suggestions.',
    modules: ['agent', 'files', 'workflows'],
    category: 'marketing',
    tags: ['marketing', 'content', 'research'],
  },
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
    icon: LinkedInIcon,
    title: 'LinkedIn content engine',
    prompt:
      'Build a workflow that scrapes my company blog for new posts, generates LinkedIn posts with hooks, insights, and calls-to-action optimized for engagement, and saves drafts as files for my review before posting to LinkedIn.',
    modules: ['agent', 'files', 'scheduled', 'workflows'],
    category: 'marketing',
    tags: ['marketing', 'content', 'automation'],
  },
  {
    icon: WordpressIcon,
    title: 'Blog auto-publisher',
    prompt:
      'Build a workflow that takes a draft document, optimizes it for SEO by researching target keywords, formats it for WordPress with proper headings and meta description, and publishes it as a draft post for final review.',
    modules: ['agent', 'files', 'workflows'],
    category: 'marketing',
    tags: ['marketing', 'content', 'automation'],
  },

  // ── Productivity ────────────────────────────────────────────────────────
  {
    icon: BookOpen,
    title: 'Personal knowledge assistant',
    prompt:
      'Create a knowledge base and connect it to my Google Drive, Notion, or Obsidian so all my notes, docs, and articles are automatically synced and embedded. Then build an agent that I can ask anything — it should answer with citations and deploy as a chat endpoint.',
    modules: ['knowledge-base', 'agent'],
    category: 'productivity',
    tags: ['individual', 'research', 'team'],
  },
  {
    icon: SlackIcon,
    title: 'Slack knowledge search',
    prompt:
      'Create a knowledge base connected to my Slack workspace so all channel conversations and threads are automatically synced and searchable. Then build an agent I can ask things like "what did the team decide about the launch date?" or "what was the outcome of the design review?" and get answers with links to the original messages.',
    modules: ['knowledge-base', 'agent'],
    category: 'productivity',
    tags: ['team', 'research', 'communication'],
  },
  {
    icon: NotionIcon,
    title: 'Notion knowledge search',
    prompt:
      'Create a knowledge base connected to my Notion workspace so all pages, databases, meeting notes, and wikis are automatically synced and searchable. Then build an agent I can ask things like "what\'s our refund policy?" or "what was decided in the Q3 planning doc?" and get instant answers with page links.',
    modules: ['knowledge-base', 'agent'],
    category: 'productivity',
    tags: ['team', 'research'],
  },
  {
    icon: GoogleDriveIcon,
    title: 'Google Drive knowledge search',
    prompt:
      'Create a knowledge base connected to my Google Drive so all documents, spreadsheets, and presentations are automatically synced and searchable. Then build an agent I can ask things like "find the board deck from last quarter" or "what were the KPIs in the marketing plan?" and get answers with doc links.',
    modules: ['knowledge-base', 'agent'],
    category: 'productivity',
    tags: ['individual', 'team', 'research'],
  },
  {
    icon: DocumentAttachment,
    title: 'Document summarizer',
    prompt:
      'Create a workflow that takes any uploaded document — PDF, contract, report, research paper — and generates a structured summary with key takeaways, action items, important dates, and a one-paragraph executive overview.',
    modules: ['files', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['individual', 'analysis', 'team'],
  },
  {
    icon: Table,
    title: 'Bulk data classifier',
    prompt:
      'Build a workflow that takes a table of unstructured data — support tickets, feedback, survey responses, leads, or any text — runs each row through an agent to classify, tag, score, and enrich it, then writes the structured results back to the table.',
    modules: ['tables', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['analysis', 'automation', 'team'],
  },
  {
    icon: File,
    title: 'Automated narrative report',
    prompt:
      'Build a scheduled workflow that pulls key data from my tables every week, analyzes trends and anomalies, and writes a narrative report — not just charts and numbers, but written insights explaining what changed, why it matters, and what to do next. Save it as a document and send a summary to Slack.',
    modules: ['tables', 'scheduled', 'agent', 'files', 'workflows'],
    category: 'productivity',
    tags: ['founder', 'reporting', 'analysis'],
  },
  {
    icon: Rocket,
    title: 'Investor update writer',
    prompt:
      'Build a workflow that pulls key metrics from my tables — revenue, growth, burn rate, headcount, milestones — and drafts a concise investor update with highlights, lowlights, asks, and KPIs. Save it as a file I can review before sending. Schedule it to run on the first of each month.',
    modules: ['tables', 'scheduled', 'agent', 'files', 'workflows'],
    category: 'productivity',
    tags: ['founder', 'reporting', 'communication'],
  },
  {
    icon: BookOpen,
    title: 'Email digest curator',
    prompt:
      'Create a scheduled daily workflow that searches the web for the latest articles, papers, and news on topics I care about, picks the top 5 most relevant pieces, writes a one-paragraph summary for each, and delivers a curated reading digest to my inbox or Slack.',
    modules: ['scheduled', 'agent', 'files', 'workflows'],
    category: 'productivity',
    tags: ['individual', 'research', 'content'],
  },
  {
    icon: Search,
    title: 'Knowledge extractor',
    prompt:
      'Build a workflow that takes raw meeting notes, brainstorm dumps, or research transcripts, extracts the key insights, decisions, and facts, organizes them by topic, and saves them into my knowledge base so they are searchable and reusable in future conversations.',
    modules: ['files', 'knowledge-base', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['individual', 'team', 'research'],
  },
  {
    icon: Calendar,
    title: 'Weekly team digest',
    prompt:
      "Build a scheduled workflow that runs every Friday, pulls the week's GitHub commits, closed Linear issues, and key Slack conversations, then emails a formatted weekly summary to the team.",
    modules: ['scheduled', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['engineering', 'team', 'reporting'],
  },
  {
    icon: ClipboardList,
    title: 'Daily standup summary',
    prompt:
      'Create a scheduled workflow that reads the #standup Slack channel each morning, summarizes what everyone is working on, identifies blockers, and posts a structured recap to a Google Doc.',
    modules: ['scheduled', 'agent', 'files', 'workflows'],
    category: 'productivity',
    tags: ['team', 'reporting', 'communication'],
  },
  {
    icon: GmailIcon,
    title: 'Email triage assistant',
    prompt:
      'Build a workflow that scans my Gmail inbox every hour, categorizes emails by urgency and type (action needed, FYI, follow-up), drafts replies for routine messages, and sends me a prioritized summary in Slack so I only open what matters. Schedule it to run hourly.',
    modules: ['agent', 'scheduled', 'workflows'],
    category: 'productivity',
    tags: ['individual', 'communication', 'automation'],
  },
  {
    icon: SlackIcon,
    title: 'Meeting notes to action items',
    prompt:
      'Create a workflow that takes meeting notes or a transcript, extracts action items with owners and due dates, creates tasks in Linear or Asana for each one, and posts a summary to the relevant Slack channel.',
    modules: ['agent', 'workflows'],
    category: 'productivity',
    tags: ['team', 'automation'],
  },
  {
    icon: GoogleSheetsIcon,
    title: 'Weekly metrics report',
    prompt:
      'Build a scheduled workflow that pulls data from Stripe and my database every Monday, calculates key metrics like MRR, churn, new subscriptions, and failed payments, populates a Google Sheet, and Slacks the team a summary with week-over-week trends.',
    modules: ['scheduled', 'tables', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['founder', 'finance', 'reporting'],
  },
  {
    icon: AmplitudeIcon,
    title: 'Product analytics digest',
    prompt:
      'Create a scheduled weekly workflow that pulls key product metrics from Amplitude — active users, feature adoption rates, retention cohorts, and top events — generates an executive summary with week-over-week trends, and posts it to Slack.',
    modules: ['scheduled', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['product', 'reporting', 'analysis'],
  },
  {
    icon: CalendlyIcon,
    title: 'Scheduling follow-up automator',
    prompt:
      'Build a workflow that monitors new Calendly bookings, researches each attendee and their company, prepares a pre-meeting brief with relevant context, and sends a personalized confirmation email with an agenda and any prep materials.',
    modules: ['agent', 'workflows'],
    category: 'productivity',
    tags: ['sales', 'research', 'automation'],
  },
  {
    icon: TwilioIcon,
    title: 'SMS appointment reminders',
    prompt:
      'Create a scheduled workflow that checks Google Calendar each morning for appointments in the next 24 hours, and sends an SMS reminder to each attendee via Twilio with the meeting time, location, and any prep notes.',
    modules: ['scheduled', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['individual', 'communication', 'automation'],
  },
  {
    icon: MicrosoftTeamsIcon,
    title: 'Microsoft Teams daily brief',
    prompt:
      'Build a scheduled workflow that pulls updates from your project tools — GitHub commits, Jira ticket status changes, and calendar events — and posts a formatted daily brief to your Microsoft Teams channel each morning.',
    modules: ['scheduled', 'agent', 'workflows'],
    category: 'productivity',
    tags: ['team', 'reporting', 'enterprise'],
  },

  // ── Operations ──────────────────────────────────────────────────────────
  {
    icon: Table,
    title: 'Data cleanup agent',
    prompt:
      'Create a workflow that takes a messy table — inconsistent formatting, duplicates, missing fields, typos — and cleans it up by standardizing values, merging duplicates, filling gaps where possible, and flagging rows that need human review.',
    modules: ['tables', 'agent', 'workflows'],
    category: 'operations',
    tags: ['automation', 'analysis'],
  },
  {
    icon: Hammer,
    title: 'Training material generator',
    prompt:
      'Create a knowledge base from my product documentation, then build a workflow that generates training materials from it — onboarding guides, FAQ documents, step-by-step tutorials, and quiz questions. Schedule it to regenerate weekly so materials stay current as docs change.',
    modules: ['knowledge-base', 'files', 'agent', 'scheduled'],
    category: 'operations',
    tags: ['hr', 'content', 'team', 'automation'],
  },
  {
    icon: File,
    title: 'SOP generator',
    prompt:
      'Create an agent that takes a brief description of any business process — from employee onboarding to incident response to content publishing — and generates a detailed standard operating procedure document with numbered steps, responsible roles, decision points, and checklists.',
    modules: ['files', 'agent'],
    category: 'operations',
    tags: ['team', 'enterprise', 'content'],
  },
  {
    icon: Card,
    title: 'Invoice processor',
    prompt:
      'Build a workflow that processes invoice PDFs from Gmail, extracts vendor name, amount, due date, and line items, then logs everything to a tracking table and sends a Slack alert for invoices due within 7 days.',
    modules: ['files', 'tables', 'agent', 'workflows'],
    category: 'operations',
    tags: ['finance', 'automation'],
  },
  {
    icon: File,
    title: 'Contract analyzer',
    prompt:
      'Create a knowledge base from my standard contract terms, then build a workflow that reviews uploaded contracts against it — extracting key clauses like payment terms, liability caps, and termination conditions, flagging deviations, and outputting a summary to a table.',
    modules: ['knowledge-base', 'files', 'tables', 'agent'],
    category: 'operations',
    tags: ['legal', 'analysis'],
  },
  {
    icon: FirecrawlIcon,
    title: 'Competitive intel monitor',
    prompt:
      'Build a scheduled workflow that scrapes competitor websites, pricing pages, and changelog pages weekly using Firecrawl, compares against previous snapshots, summarizes any changes, logs them to a tracking table, and sends a Slack alert for major updates.',
    modules: ['scheduled', 'tables', 'agent', 'workflows'],
    category: 'operations',
    tags: ['founder', 'product', 'monitoring', 'research'],
  },
  {
    icon: StripeIcon,
    title: 'Revenue operations dashboard',
    prompt:
      'Create a scheduled daily workflow that pulls payment data from Stripe, calculates MRR, net revenue, failed payments, and new subscriptions, logs everything to a table with historical tracking, and sends a daily Slack summary with trends and anomalies.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'operations',
    tags: ['finance', 'founder', 'reporting', 'monitoring'],
  },
  {
    icon: ShopifyIcon,
    title: 'E-commerce order monitor',
    prompt:
      'Build a workflow that monitors Shopify orders, flags high-value or unusual orders for review, tracks fulfillment status in a table, and sends daily inventory and sales summaries to Slack with restock alerts when items run low.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'operations',
    tags: ['ecommerce', 'monitoring', 'reporting'],
  },
  {
    icon: ShieldCheck,
    title: 'Compliance document checker',
    prompt:
      'Create a knowledge base from my compliance requirements and policies, then build an agent that reviews uploaded policy documents and SOC 2 evidence against it, identifies gaps or outdated sections, and generates a remediation checklist file with priority levels.',
    modules: ['knowledge-base', 'files', 'agent'],
    category: 'operations',
    tags: ['legal', 'enterprise', 'analysis'],
  },
  {
    icon: Users,
    title: 'New hire onboarding automation',
    prompt:
      "Build a workflow that when triggered with a new hire's info, creates their accounts, sends a personalized welcome message in Slack, schedules 1:1s with their team on Google Calendar, shares relevant onboarding docs from the knowledge base, and tracks completion in a table.",
    modules: ['knowledge-base', 'tables', 'agent', 'workflows'],
    category: 'operations',
    tags: ['hr', 'automation', 'team'],
  },
  {
    icon: ClipboardList,
    title: 'Candidate screening assistant',
    prompt:
      'Create a knowledge base from my job descriptions and hiring criteria, then build a workflow that takes uploaded resumes, evaluates candidates against the requirements, scores them on experience, skills, and culture fit, and populates a comparison table with a summary and recommendation for each.',
    modules: ['knowledge-base', 'files', 'tables', 'agent'],
    category: 'operations',
    tags: ['hr', 'recruiting', 'analysis'],
  },
  {
    icon: GreenhouseIcon,
    title: 'Recruiting pipeline automator',
    prompt:
      'Build a scheduled workflow that syncs open jobs and candidates from Greenhouse to a tracking table daily, flags candidates who have been in the same stage for more than 5 days, and sends a Slack summary to hiring managers with pipeline stats and bottlenecks.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'operations',
    tags: ['hr', 'recruiting', 'monitoring', 'reporting'],
  },
  {
    icon: DatadogIcon,
    title: 'Infrastructure health report',
    prompt:
      'Create a scheduled daily workflow that queries Datadog for key infrastructure metrics — error rates, latency percentiles, CPU and memory usage — logs them to a table for trend tracking, and sends a morning Slack report highlighting any anomalies or degradations.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'operations',
    tags: ['devops', 'infrastructure', 'monitoring', 'reporting'],
  },
  {
    icon: AirtableIcon,
    title: 'Airtable data sync',
    prompt:
      'Create a scheduled workflow that syncs records from my Airtable base into a Sim table every hour, keeping both in sync. Use an agent to detect changes, resolve conflicts, and flag any discrepancies for review in Slack.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'operations',
    tags: ['sync', 'automation'],
  },
  {
    icon: Search,
    title: 'Multi-source knowledge hub',
    prompt:
      'Create a knowledge base and connect it to Confluence, Notion, and Google Drive so all my company documentation is automatically synced, chunked, and embedded. Then deploy a Q&A agent that can answer questions across all sources with citations.',
    modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
    category: 'operations',
    tags: ['enterprise', 'team', 'sync', 'automation'],
  },
  {
    icon: Table,
    title: 'Customer 360 view',
    prompt:
      'Create a comprehensive customer table that aggregates data from my CRM, support tickets, billing history, and product usage into a single unified view per customer. Schedule it to sync daily and send a Slack alert when any customer shows signs of trouble across multiple signals.',
    modules: ['tables', 'scheduled', 'agent', 'workflows'],
    category: 'operations',
    tags: ['founder', 'sales', 'support', 'enterprise', 'sync'],
  },
]
