import type { PreviewWorkflow } from '@/app/(home)/components/landing-preview/components/landing-preview-workflow/workflow-data'

/**
 * OCR Invoice to DB — Start → Agent (Textract) → Supabase
 * Pattern: Straight line (all blocks aligned at top)
 */
const OCR_INVOICE_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-ocr-invoice',
  name: 'OCR Invoice to DB',
  color: '#2ABBF8',
  blocks: [
    {
      id: 'starter-1',
      name: 'Start',
      type: 'starter',
      bgColor: '#34B5FF',
      rows: [{ title: 'URL', value: 'invoice.pdf' }],
      position: { x: 40, y: 80 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-1',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gpt-5.2' },
        { title: 'System Prompt', value: 'Extract invoice fields...' },
      ],
      tools: [{ name: 'Textract', type: 'textract', bgColor: '#055F4E' }],
      position: { x: 400, y: 100 },
    },
    {
      id: 'supabase-1',
      name: 'Supabase',
      type: 'supabase',
      bgColor: '#1C1C1C',
      rows: [
        { title: 'Table', value: 'invoices' },
        { title: 'Operation', value: 'Insert Row' },
      ],
      position: { x: 760, y: 80 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'starter-1', target: 'agent-1' },
    { id: 'e-2', source: 'agent-1', target: 'supabase-1' },
  ],
}

/**
 * GitHub Release Agent — GitHub → Agent → Slack
 * Pattern: Convex (low → high → low)
 */
const GITHUB_RELEASE_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-github-release',
  name: 'GitHub Release Agent',
  color: '#00F701',
  blocks: [
    {
      id: 'github-1',
      name: 'GitHub',
      type: 'github',
      bgColor: '#181C1E',
      rows: [
        { title: 'Event', value: 'New Release' },
        { title: 'Repository', value: 'org/repo' },
      ],
      position: { x: 60, y: 140 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-2',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'claude-sonnet-4.6' },
        { title: 'System Prompt', value: 'Summarize changelog...' },
      ],
      position: { x: 370, y: 50 },
    },
    {
      id: 'slack-1',
      name: 'Slack',
      type: 'slack',
      bgColor: '#611f69',
      rows: [
        { title: 'Channel', value: '#releases' },
        { title: 'Operation', value: 'Send Message' },
      ],
      position: { x: 680, y: 140 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'github-1', target: 'agent-2' },
    { id: 'e-2', source: 'agent-2', target: 'slack-1' },
  ],
}

/**
 * Meeting Follow-up Agent — Google Calendar → Agent → Gmail
 * Pattern: Concave (high → low → high)
 */
const MEETING_FOLLOWUP_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-meeting-followup',
  name: 'Meeting Follow-up Agent',
  color: '#FFCC02',
  blocks: [
    {
      id: 'gcal-1',
      name: 'Google Calendar',
      type: 'google_calendar',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Event', value: 'Meeting Ended' },
        { title: 'Calendar', value: 'Work' },
      ],
      position: { x: 60, y: 60 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-3',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gemini-2.5-pro' },
        { title: 'System Prompt', value: 'Draft follow-up email...' },
      ],
      position: { x: 370, y: 150 },
    },
    {
      id: 'gmail-1',
      name: 'Gmail',
      type: 'gmail',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Operation', value: 'Send Email' },
        { title: 'To', value: 'attendees' },
      ],
      position: { x: 680, y: 60 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'gcal-1', target: 'agent-3' },
    { id: 'e-2', source: 'agent-3', target: 'gmail-1' },
  ],
}

/**
 * CV/Resume Scanner — Start → Agent (Reducto) → Google Sheets
 * Pattern: Convex (low → high → low)
 */
const CV_SCANNER_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-cv-scanner',
  name: 'CV/Resume Scanner',
  color: '#FA4EDF',
  blocks: [
    {
      id: 'starter-2',
      name: 'Start',
      type: 'starter',
      bgColor: '#34B5FF',
      rows: [{ title: 'File URL', value: 'resume.pdf' }],
      position: { x: 60, y: 145 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-4',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'claude-opus-4.6' },
        { title: 'System Prompt', value: 'Parse resume fields...' },
      ],
      tools: [{ name: 'Reducto', type: 'reducto', bgColor: '#5c0c5c' }],
      position: { x: 370, y: 55 },
    },
    {
      id: 'gsheets-1',
      name: 'Google Sheets',
      type: 'google_sheets',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Spreadsheet', value: 'Candidates' },
        { title: 'Operation', value: 'Append Row' },
      ],
      position: { x: 680, y: 145 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'starter-2', target: 'agent-4' },
    { id: 'e-2', source: 'agent-4', target: 'gsheets-1' },
  ],
}

/**
 * Email Triage Agent — Gmail → Agent (KB) → fan-out to Slack + Linear
 * Pattern: Fan-out (input low → agent mid → outputs spread vertically)
 */
const EMAIL_TRIAGE_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-email-triage',
  name: 'Email Triage Agent',
  color: '#FF6B2C',
  blocks: [
    {
      id: 'gmail-2',
      name: 'Gmail',
      type: 'gmail',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Event', value: 'New Email' },
        { title: 'Label', value: 'Inbox' },
      ],
      position: { x: 60, y: 130 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-5',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gpt-5.2-mini' },
        { title: 'System Prompt', value: 'Classify and route...' },
      ],
      tools: [{ name: 'Knowledge Base', type: 'knowledge_base', bgColor: '#00B0B0' }],
      position: { x: 370, y: 100 },
    },
    {
      id: 'slack-2',
      name: 'Slack',
      type: 'slack',
      bgColor: '#611f69',
      rows: [
        { title: 'Channel', value: '#urgent' },
        { title: 'Operation', value: 'Send Message' },
      ],
      position: { x: 680, y: 20 },
      hideSourceHandle: true,
    },
    {
      id: 'linear-1',
      name: 'Linear',
      type: 'linear',
      bgColor: '#5E6AD2',
      rows: [
        { title: 'Project', value: 'Support' },
        { title: 'Operation', value: 'Create Issue' },
      ],
      position: { x: 680, y: 200 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'gmail-2', target: 'agent-5' },
    { id: 'e-2', source: 'agent-5', target: 'slack-2' },
    { id: 'e-3', source: 'agent-5', target: 'linear-1' },
  ],
}

/**
 * Competitor Monitor — Schedule → Agent (Firecrawl) → Slack
 * Pattern: Concave (high → low → high)
 */
const COMPETITOR_MONITOR_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-competitor-monitor',
  name: 'Competitor Monitor',
  color: '#6366F1',
  blocks: [
    {
      id: 'schedule-1',
      name: 'Schedule',
      type: 'schedule',
      bgColor: '#6366F1',
      rows: [
        { title: 'Run Frequency', value: 'Daily' },
        { title: 'Time', value: '08:00 AM' },
      ],
      position: { x: 60, y: 50 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-6',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'grok-4' },
        { title: 'System Prompt', value: 'Monitor competitor...' },
      ],
      tools: [{ name: 'Firecrawl', type: 'firecrawl', bgColor: '#181C1E' }],
      position: { x: 370, y: 150 },
    },
    {
      id: 'slack-3',
      name: 'Slack',
      type: 'slack',
      bgColor: '#611f69',
      rows: [
        { title: 'Channel', value: '#competitive-intel' },
        { title: 'Operation', value: 'Send Message' },
      ],
      position: { x: 680, y: 50 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'schedule-1', target: 'agent-6' },
    { id: 'e-2', source: 'agent-6', target: 'slack-3' },
  ],
}

/**
 * Social Listening Agent — Schedule → Agent (Reddit + X) → Notion
 * Pattern: Convex (low → high → low)
 */
const SOCIAL_LISTENING_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-social-listening',
  name: 'Social Listening Agent',
  color: '#F43F5E',
  blocks: [
    {
      id: 'schedule-2',
      name: 'Schedule',
      type: 'schedule',
      bgColor: '#6366F1',
      rows: [{ title: 'Run Frequency', value: 'Hourly' }],
      position: { x: 60, y: 150 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-7',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gemini-2.5-flash' },
        { title: 'System Prompt', value: 'Track brand mentions...' },
      ],
      tools: [
        { name: 'Reddit', type: 'reddit', bgColor: '#FF5700' },
        { name: 'X', type: 'x', bgColor: '#000000' },
      ],
      position: { x: 370, y: 55 },
    },
    {
      id: 'notion-1',
      name: 'Notion',
      type: 'notion',
      bgColor: '#181C1E',
      rows: [
        { title: 'Database', value: 'Brand Mentions' },
        { title: 'Operation', value: 'Create Page' },
      ],
      position: { x: 680, y: 150 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'schedule-2', target: 'agent-7' },
    { id: 'e-2', source: 'agent-7', target: 'notion-1' },
  ],
}

/**
 * Data Enrichment Pipeline — Start → Agent (LinkedIn) → Google Sheets
 * Pattern: Concave (high → low → high)
 */
const DATA_ENRICHMENT_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-data-enrichment',
  name: 'Data Enrichment Pipeline',
  color: '#14B8A6',
  blocks: [
    {
      id: 'starter-3',
      name: 'Start',
      type: 'starter',
      bgColor: '#34B5FF',
      rows: [{ title: 'Email', value: 'lead@company.com' }],
      position: { x: 60, y: 55 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-8',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'mistral-large' },
        { title: 'System Prompt', value: 'Enrich lead data...' },
      ],
      tools: [{ name: 'LinkedIn', type: 'linkedin', bgColor: '#0072B1' }],
      position: { x: 370, y: 145 },
    },
    {
      id: 'gsheets-2',
      name: 'Google Sheets',
      type: 'google_sheets',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Spreadsheet', value: 'Lead Database' },
        { title: 'Operation', value: 'Update Row' },
      ],
      position: { x: 680, y: 55 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'starter-3', target: 'agent-8' },
    { id: 'e-2', source: 'agent-8', target: 'gsheets-2' },
  ],
}

/**
 * Customer Feedback Digest — Schedule → Agent → Slack
 * Pattern: Convex (low → high → low)
 */
const FEEDBACK_DIGEST_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-feedback-digest',
  name: 'Customer Feedback Digest',
  color: '#F59E0B',
  blocks: [
    {
      id: 'schedule-3',
      name: 'Schedule',
      type: 'schedule',
      bgColor: '#6366F1',
      rows: [
        { title: 'Run Frequency', value: 'Daily' },
        { title: 'Time', value: '09:00 AM' },
      ],
      position: { x: 60, y: 145 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-9',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'claude-sonnet-4.6' },
        { title: 'System Prompt', value: 'Analyze customer feedback...' },
      ],
      tools: [{ name: 'Airtable', type: 'airtable', bgColor: '#18BFFF' }],
      position: { x: 370, y: 50 },
    },
    {
      id: 'slack-4',
      name: 'Slack',
      type: 'slack',
      bgColor: '#611f69',
      rows: [
        { title: 'Channel', value: '#product-feedback' },
        { title: 'Operation', value: 'Send Message' },
      ],
      position: { x: 680, y: 145 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'schedule-3', target: 'agent-9' },
    { id: 'e-2', source: 'agent-9', target: 'slack-4' },
  ],
}

/**
 * PR Review Agent — GitHub → Agent → Slack
 * Pattern: Concave (high → low → high)
 */
const PR_REVIEW_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-pr-review',
  name: 'PR Review Agent',
  color: '#06B6D4',
  blocks: [
    {
      id: 'github-2',
      name: 'GitHub',
      type: 'github',
      bgColor: '#181C1E',
      rows: [
        { title: 'Event', value: 'Pull Request Opened' },
        { title: 'Repository', value: 'org/repo' },
      ],
      position: { x: 60, y: 60 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-10',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gpt-5.2' },
        { title: 'System Prompt', value: 'Review code changes...' },
      ],
      position: { x: 370, y: 155 },
    },
    {
      id: 'slack-5',
      name: 'Slack',
      type: 'slack',
      bgColor: '#611f69',
      rows: [
        { title: 'Channel', value: '#code-reviews' },
        { title: 'Operation', value: 'Send Message' },
      ],
      position: { x: 680, y: 60 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'github-2', target: 'agent-10' },
    { id: 'e-2', source: 'agent-10', target: 'slack-5' },
  ],
}

/**
 * Knowledge Base QA — Start → Agent (KB) → Response
 * Pattern: Convex (low → high → low)
 */
const KNOWLEDGE_QA_WORKFLOW: PreviewWorkflow = {
  id: 'tpl-knowledge-qa',
  name: 'Knowledge Base QA',
  color: '#84CC16',
  blocks: [
    {
      id: 'starter-4',
      name: 'Start',
      type: 'starter',
      bgColor: '#34B5FF',
      rows: [{ title: 'Question', value: 'How do I...' }],
      position: { x: 60, y: 140 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-11',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gemini-2.5-pro' },
        { title: 'System Prompt', value: 'Answer using knowledge...' },
      ],
      tools: [{ name: 'Knowledge Base', type: 'knowledge_base', bgColor: '#00B0B0' }],
      position: { x: 370, y: 50 },
    },
    {
      id: 'starter-5',
      name: 'Response',
      type: 'starter',
      bgColor: '#34B5FF',
      rows: [{ title: 'Answer', value: 'Based on your docs...' }],
      position: { x: 680, y: 140 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'starter-4', target: 'agent-11' },
    { id: 'e-2', source: 'agent-11', target: 'starter-5' },
  ],
}

export const TEMPLATE_WORKFLOWS: PreviewWorkflow[] = [
  OCR_INVOICE_WORKFLOW,
  GITHUB_RELEASE_WORKFLOW,
  MEETING_FOLLOWUP_WORKFLOW,
  CV_SCANNER_WORKFLOW,
  EMAIL_TRIAGE_WORKFLOW,
  COMPETITOR_MONITOR_WORKFLOW,
  SOCIAL_LISTENING_WORKFLOW,
  DATA_ENRICHMENT_WORKFLOW,
  FEEDBACK_DIGEST_WORKFLOW,
  PR_REVIEW_WORKFLOW,
  KNOWLEDGE_QA_WORKFLOW,
]
