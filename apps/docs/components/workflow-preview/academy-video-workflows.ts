import type { PreviewWorkflow } from './workflow-data'

/**
 * Workflows shown in the academy videos, reproduced block-for-block so each
 * page's written supplement shows the same machine the video builds. Rows and
 * operation labels match the videos (which match the block registry).
 */

/** files/intro + files/object — the invoice intake machine. */
export const AV_INVOICE_INTAKE_WORKFLOW: PreviewWorkflow = {
  id: 'av-invoice-intake',
  name: 'Invoice intake',
  blocks: [
    {
      id: 'gmailtrigger',
      name: 'Gmail Email Trigger',
      type: 'gmail',
      bgColor: '#E0E0E0',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Include Attachments', value: 'Enabled' }],
    },
    {
      id: 'file',
      name: 'File',
      type: 'file',
      bgColor: '#40916C',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Operation', value: 'Read' },
        { title: 'Files', value: '<gmailtrigger.attachments[0]>' },
      ],
    },
    {
      id: 'agent',
      name: 'Agent',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 680, y: 0 },
      rows: [
        { title: 'Messages', value: 'Extract the invoice fields' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
        { title: 'Files', value: '<file.files[0]>' },
      ],
    },
    {
      id: 'supabase',
      name: 'Supabase',
      type: 'supabase',
      bgColor: '#1C1C1C',
      position: { x: 1020, y: 0 },
      rows: [
        { title: 'Operation', value: 'Create a Row' },
        { title: 'Table', value: 'invoices' },
        { title: 'Data', value: '<agent.content>' },
      ],
    },
  ],
  edges: [
    { id: 'trigger-file', source: 'gmailtrigger', target: 'file' },
    { id: 'file-agent', source: 'file', target: 'agent' },
    { id: 'agent-supabase', source: 'agent', target: 'supabase' },
  ],
}

/** agents/block — the Qualify agent the camera rides through. */
export const AV_QUALIFY_WORKFLOW: PreviewWorkflow = {
  id: 'av-qualify',
  name: 'Qualify a lead',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Lead' }],
    },
    {
      id: 'qualify',
      name: 'Qualify',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Messages', value: 'Qualify this lead: <start.input>' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
      ],
    },
    {
      id: 'response',
      name: 'Response',
      type: 'response',
      bgColor: '#2F55FF',
      position: { x: 680, y: 0 },
      rows: [{ title: 'Data', value: '<qualify.content>' }],
    },
  ],
  edges: [
    { id: 'start-qualify', source: 'start', target: 'qualify' },
    { id: 'qualify-response', source: 'qualify', target: 'response' },
  ],
}

/** agents/memory — the Support agent with Memory set to Conversation. */
export const AV_MEMORY_WORKFLOW: PreviewWorkflow = {
  id: 'av-memory',
  name: 'Support agent with memory',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Customer message' }],
    },
    {
      id: 'support',
      name: 'Support',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Messages', value: '<start.input>' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
        { title: 'Memory', value: 'Conversation · user-123' },
      ],
    },
  ],
  edges: [{ id: 'start-support', source: 'start', target: 'support' }],
}

/** tables/operations — the Table block with a filtered query. */
export const AV_TABLE_OPS_WORKFLOW: PreviewWorkflow = {
  id: 'av-table-ops',
  name: 'Query the tickets table',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Run' }],
    },
    {
      id: 'table',
      name: 'Table 1',
      type: 'table',
      bgColor: '#10B981',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Operation', value: 'Query Rows' },
        { title: 'Table', value: 'tickets' },
        { title: 'Filter Conditions', value: 'priority equals high' },
      ],
    },
  ],
  edges: [{ id: 'start-table', source: 'start', target: 'table' }],
}

/** agents/tool-calling — the Qualify agent with research tools attached. */
export const AV_TOOLS_WORKFLOW: PreviewWorkflow = {
  id: 'av-tools',
  name: 'Qualify with tools',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Lead' }],
    },
    {
      id: 'qualify',
      name: 'Qualify',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Messages', value: 'Qualify this lead: <start.input>' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
      ],
      tools: [
        { type: 'exa', name: 'Search', bgColor: '#1F40ED' },
        { type: 'github', name: 'GitHub', bgColor: '#181717' },
        { type: 'hubspot', name: 'CRM', bgColor: '#FF7A59' },
      ],
    },
    {
      id: 'response',
      name: 'Response',
      type: 'response',
      bgColor: '#2F55FF',
      position: { x: 680, y: 0 },
      rows: [{ title: 'Data', value: '<qualify.content>' }],
    },
  ],
  edges: [
    { id: 'start-qualify', source: 'start', target: 'qualify' },
    { id: 'qualify-response', source: 'qualify', target: 'response' },
  ],
}

/** agents/skills — the same agent with a skill attached. */
export const AV_SKILLS_WORKFLOW: PreviewWorkflow = {
  id: 'av-skills',
  name: 'Qualify with a skill',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Lead' }],
    },
    {
      id: 'qualify',
      name: 'Qualify',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Messages', value: 'Qualify this lead: <start.input>' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
        { title: 'Skills', value: 'answer-with-citations' },
      ],
      tools: [{ type: 'exa', name: 'Search', bgColor: '#1F40ED' }],
    },
  ],
  edges: [{ id: 'start-qualify', source: 'start', target: 'qualify' }],
}

/** chat/intro — the support-desk workflow the chat operates. */
export const AV_SUPPORT_DESK_WORKFLOW: PreviewWorkflow = {
  id: 'av-support-desk',
  name: 'support-desk',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 60 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Ticket' }],
    },
    {
      id: 'triage',
      name: 'Triage',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 320, y: 60 },
      rows: [
        { title: 'Messages', value: '<start.input>' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
      ],
      tools: [{ type: 'knowledge', name: 'Help Center', bgColor: '#00B0B0' }],
    },
    {
      id: 'condition',
      name: 'Urgent?',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 660, y: 60 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<triage.urgent>' },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'escalate',
      name: 'Escalate',
      type: 'slack',
      bgColor: '#611F69',
      position: { x: 1000, y: -40 },
      rows: [{ title: 'Channel', value: '#support-urgent' }],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 1000, y: 160 },
      rows: [{ title: 'Messages', value: 'Draft the reply' }],
    },
    {
      id: 'log',
      name: 'Log',
      type: 'table',
      bgColor: '#10B981',
      position: { x: 1340, y: 60 },
      rows: [
        { title: 'Operation', value: 'Insert Row' },
        { title: 'Table', value: 'tickets' },
      ],
    },
  ],
  edges: [
    { id: 'start-triage', source: 'start', target: 'triage' },
    { id: 'triage-condition', source: 'triage', target: 'condition' },
    {
      id: 'condition-escalate',
      source: 'condition',
      target: 'escalate',
      sourceHandle: 'condition-if',
    },
    { id: 'condition-reply', source: 'condition', target: 'reply', sourceHandle: 'condition-else' },
    { id: 'escalate-log', source: 'escalate', target: 'log' },
    { id: 'reply-log', source: 'reply', target: 'log' },
  ],
}

/** chat/building — the content-agent the chat builds: candidates drafted in
 *  parallel, media generated, an evaluator scoring, results kept. */
export const AV_CONTENT_AGENT_WORKFLOW: PreviewWorkflow = {
  id: 'av-content-agent',
  name: 'content-agent',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 95 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Idea' }],
    },
    {
      id: 'candidates',
      name: 'Candidates',
      type: 'parallel',
      bgColor: '#1D1C1A',
      position: { x: 320, y: 30 },
      size: { width: 430, height: 170 },
      rows: [],
    },
    {
      id: 'writer',
      name: 'Writer',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 150, y: 62 },
      parentId: 'candidates',
      rows: [
        { title: 'Messages', value: '<start.input>' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
      ],
    },
    {
      id: 'evaluator',
      name: 'Evaluator',
      type: 'evaluator',
      bgColor: '#8B5CF6',
      position: { x: 840, y: 95 },
      rows: [
        { title: 'Metrics', value: 'Voice · Hook' },
        { title: 'Content', value: '<writer.content>' },
      ],
    },
    {
      id: 'scores',
      name: 'Scores',
      type: 'table',
      bgColor: '#10B981',
      position: { x: 1180, y: 95 },
      rows: [
        { title: 'Operation', value: 'Insert Row' },
        { title: 'Table', value: 'scores' },
      ],
    },
  ],
  edges: [
    { id: 'start-candidates', source: 'start', target: 'candidates' },
    {
      id: 'candidates-writer',
      source: 'candidates',
      target: 'writer',
      sourceHandle: 'parallel-start-source',
    },
    { id: 'candidates-evaluator', source: 'candidates', target: 'evaluator' },
    { id: 'evaluator-scores', source: 'evaluator', target: 'scores' },
  ],
}

/** use-cases/slack-it-triage — the IT triage machine from the video. */
export const AV_IT_TRIAGE_WORKFLOW: PreviewWorkflow = {
  id: 'av-it-triage',
  name: 'it-triage',
  blocks: [
    {
      id: 'ithelptrigger',
      name: 'IT Help Trigger',
      type: 'slack',
      bgColor: '#611F69',
      position: { x: 0, y: 100 },
      hideTargetHandle: true,
      rows: [{ title: 'Channel', value: '#it-help' }],
    },
    {
      id: 'triage',
      name: 'Triage',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 100 },
      rows: [
        { title: 'Messages', value: 'Classify this request' },
        { title: 'Model', value: 'gpt-5.6-luna' },
        { title: 'Response Format', value: 'category · answerable | escalate' },
      ],
    },
    {
      id: 'condition',
      name: 'Answerable?',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 680, y: 100 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<triage.category> = answerable' },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'knowledge',
      name: 'Knowledge',
      type: 'knowledge',
      bgColor: '#00B0B0',
      position: { x: 1020, y: -10 },
      rows: [
        { title: 'Knowledge Base', value: 'IT Docs' },
        { title: 'Top K', value: '3' },
      ],
    },
    {
      id: 'answer',
      name: 'Answer',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 1360, y: -10 },
      rows: [
        { title: 'Messages', value: 'Answer from <knowledge.results>' },
        { title: 'Model', value: 'claude-sonnet-5' },
      ],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'slack',
      bgColor: '#611F69',
      position: { x: 1700, y: -10 },
      rows: [
        { title: 'Channel', value: '#it-help' },
        { title: 'Thread TS', value: '<ithelptrigger.ts>' },
      ],
    },
    {
      id: 'escalate',
      name: 'Escalate',
      type: 'slack',
      bgColor: '#611F69',
      position: { x: 1020, y: 230 },
      rows: [{ title: 'Channel', value: '#it-escalations' }],
    },
  ],
  edges: [
    { id: 'trigger-triage', source: 'ithelptrigger', target: 'triage' },
    { id: 'triage-condition', source: 'triage', target: 'condition' },
    {
      id: 'condition-knowledge',
      source: 'condition',
      target: 'knowledge',
      sourceHandle: 'condition-if',
    },
    { id: 'knowledge-answer', source: 'knowledge', target: 'answer' },
    { id: 'answer-reply', source: 'answer', target: 'reply' },
    {
      id: 'condition-escalate',
      source: 'condition',
      target: 'escalate',
      sourceHandle: 'condition-else',
    },
  ],
}

/** use-cases/monitoring-research — the morning-watch machine. */
export const AV_MORNING_WATCH_WORKFLOW: PreviewWorkflow = {
  id: 'av-morning-watch',
  name: 'morning-watch',
  blocks: [
    {
      id: 'schedule',
      name: 'Schedule',
      type: 'schedule',
      bgColor: '#6366F1',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Frequency', value: 'Daily · 7:00' }],
    },
    {
      id: 'research',
      name: 'Research',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Messages', value: 'What changed since yesterday?' },
        { title: 'Model', value: 'claude-sonnet-5' },
      ],
      tools: [
        { type: 'exa', name: 'Search', bgColor: '#1F40ED' },
        { type: 'firecrawl', name: 'Read Pages', bgColor: '#181C1E' },
      ],
    },
    {
      id: 'digest',
      name: 'Digest',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 680, y: 0 },
      rows: [{ title: 'Messages', value: 'Summarize: <research.content>' }],
    },
    {
      id: 'post',
      name: 'Post',
      type: 'slack',
      bgColor: '#611F69',
      position: { x: 1020, y: 0 },
      rows: [{ title: 'Channel', value: '#market-watch' }],
    },
  ],
  edges: [
    { id: 'schedule-research', source: 'schedule', target: 'research' },
    { id: 'research-digest', source: 'research', target: 'digest' },
    { id: 'digest-post', source: 'digest', target: 'post' },
  ],
}

/** use-cases/document-extraction — email attachment to table row. */
export const AV_DOC_EXTRACTION_WORKFLOW: PreviewWorkflow = {
  id: 'av-doc-extraction',
  name: 'invoice-extraction',
  blocks: [
    {
      id: 'gmailtrigger',
      name: 'Gmail Email Trigger',
      type: 'gmail',
      bgColor: '#E0E0E0',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Include Attachments', value: 'Enabled' }],
    },
    {
      id: 'extract',
      name: 'Extract',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Messages', value: 'Extract the invoice fields' },
        { title: 'Model', value: 'claude-sonnet-5' },
        { title: 'Response Format', value: 'vendor · amount · due_date' },
      ],
    },
    {
      id: 'saverow',
      name: 'Save Row',
      type: 'table',
      bgColor: '#10B981',
      position: { x: 680, y: 0 },
      rows: [
        { title: 'Operation', value: 'Insert Row' },
        { title: 'Table', value: 'Invoices' },
        { title: 'Data', value: '<extract.vendor> · <extract.amount>' },
      ],
    },
  ],
  edges: [
    { id: 'trigger-extract', source: 'gmailtrigger', target: 'extract' },
    { id: 'extract-saverow', source: 'extract', target: 'saverow' },
  ],
}

/** use-cases/sales-data-enrichment — the per-row chain the table fans out. */
export const AV_LEAD_ENRICHMENT_WORKFLOW: PreviewWorkflow = {
  id: 'av-lead-enrichment',
  name: 'enrich-lead',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'company · contact' }],
    },
    {
      id: 'research',
      name: 'Research',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Messages', value: 'Research <start.company>' },
        { title: 'Model', value: 'claude-sonnet-5' },
      ],
      tools: [
        { type: 'exa', name: 'Search', bgColor: '#1F40ED' },
        { type: 'firecrawl', name: 'Read Pages', bgColor: '#181C1E' },
      ],
    },
    {
      id: 'score',
      name: 'Score',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 680, y: 0 },
      rows: [{ title: 'Messages', value: 'Score the fit: <research.content>' }],
    },
  ],
  edges: [
    { id: 'start-research', source: 'start', target: 'research' },
    { id: 'research-score', source: 'research', target: 'score' },
  ],
}

/** use-cases/telegram-personal-assistant — the three-lane assistant. */
export const AV_TELEGRAM_ASSISTANT_WORKFLOW: PreviewWorkflow = {
  id: 'av-telegram-assistant',
  name: 'telegram-assistant',
  blocks: [
    {
      id: 'telegramtrigger',
      name: 'Telegram Trigger',
      type: 'telegram',
      bgColor: '#E0E0E0',
      position: { x: 0, y: 200 },
      hideTargetHandle: true,
      rows: [{ title: 'Message', value: '<telegram.message>' }],
    },
    {
      id: 'router',
      name: 'Router',
      type: 'router',
      bgColor: '#28C43F',
      position: { x: 340, y: 200 },
      rows: [],
      branches: [
        { id: 'router-email', label: 'Email' },
        { id: 'router-calendar', label: 'Calendar' },
        { id: 'router-research', label: 'Research' },
      ],
    },
    {
      id: 'email',
      name: 'Email',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 680, y: 0 },
      rows: [{ title: 'Messages', value: 'Answer from my inbox' }],
      tools: [{ type: 'gmail', name: 'Read Email', bgColor: '#E0E0E0' }],
    },
    {
      id: 'calendar',
      name: 'Calendar',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 680, y: 200 },
      rows: [{ title: 'Messages', value: 'Answer from my calendar' }],
      tools: [{ type: 'google_calendar', name: 'List Events', bgColor: '#E0E0E0' }],
    },
    {
      id: 'research',
      name: 'Research',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 680, y: 400 },
      rows: [{ title: 'Messages', value: 'Research the question' }],
      tools: [{ type: 'exa', name: 'Search', bgColor: '#1F40ED' }],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'telegram',
      bgColor: '#E0E0E0',
      position: { x: 1020, y: 200 },
      rows: [{ title: 'Chat ID', value: '<telegramtrigger.chatId>' }],
    },
  ],
  edges: [
    { id: 'trigger-router', source: 'telegramtrigger', target: 'router' },
    { id: 'router-email', source: 'router', target: 'email', sourceHandle: 'router-email' },
    {
      id: 'router-calendar',
      source: 'router',
      target: 'calendar',
      sourceHandle: 'router-calendar',
    },
    {
      id: 'router-research',
      source: 'router',
      target: 'research',
      sourceHandle: 'router-research',
    },
    { id: 'email-reply', source: 'email', target: 'reply' },
    { id: 'calendar-reply', source: 'calendar', target: 'reply' },
    { id: 'research-reply', source: 'research', target: 'reply' },
  ],
}

/** use-cases/telegram-personal-assistant — the second, scheduled brief. */
export const AV_MORNING_BRIEF_WORKFLOW: PreviewWorkflow = {
  id: 'av-morning-brief',
  name: 'morning-brief',
  blocks: [
    {
      id: 'schedule',
      name: 'Schedule',
      type: 'schedule',
      bgColor: '#6366F1',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Frequency', value: 'Daily · 7:00' }],
    },
    {
      id: 'brief',
      name: 'Brief',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      rows: [{ title: 'Messages', value: 'Summarize my day' }],
      tools: [
        { type: 'gmail', name: 'Read Email', bgColor: '#E0E0E0' },
        { type: 'google_calendar', name: 'List Events', bgColor: '#E0E0E0' },
      ],
    },
    {
      id: 'send',
      name: 'Send',
      type: 'telegram',
      bgColor: '#E0E0E0',
      position: { x: 680, y: 0 },
      rows: [{ title: 'Message', value: '<brief.content>' }],
    },
  ],
  edges: [
    { id: 'schedule-brief', source: 'schedule', target: 'brief' },
    { id: 'brief-send', source: 'brief', target: 'send' },
  ],
}

/** use-cases/scheduled-report-rollup — two sources reconciled weekly. */
export const AV_REPORT_ROLLUP_WORKFLOW: PreviewWorkflow = {
  id: 'av-report-rollup',
  name: 'weekly-rollup',
  blocks: [
    {
      id: 'schedule',
      name: 'Schedule',
      type: 'schedule',
      bgColor: '#6366F1',
      position: { x: 0, y: 110 },
      hideTargetHandle: true,
      rows: [{ title: 'Frequency', value: 'Weekly · Mon 7:00' }],
    },
    {
      id: 'stripe',
      name: 'Stripe',
      type: 'stripe',
      bgColor: '#635BFF',
      position: { x: 340, y: 0 },
      rows: [{ title: 'Operation', value: 'List Charges' }],
    },
    {
      id: 'sheets',
      name: 'Sheets',
      type: 'google_sheets',
      bgColor: '#FFFFFF',
      position: { x: 340, y: 220 },
      rows: [
        { title: 'Operation', value: 'Read Data' },
        { title: 'Range', value: 'Tracking!A:D' },
      ],
    },
    {
      id: 'reconcile',
      name: 'Reconcile',
      type: 'function',
      bgColor: '#FF402F',
      position: { x: 680, y: 110 },
      rows: [{ title: 'Code', value: 'reconcile(charges, rows)' }],
    },
    {
      id: 'record',
      name: 'Record',
      type: 'table',
      bgColor: '#10B981',
      position: { x: 1020, y: 110 },
      rows: [
        { title: 'Operation', value: 'Insert Row' },
        { title: 'Table', value: 'weekly_reports' },
      ],
    },
    {
      id: 'digest',
      name: 'Digest',
      type: 'slack',
      bgColor: '#611F69',
      position: { x: 1360, y: 110 },
      rows: [{ title: 'Channel', value: '#finance' }],
    },
  ],
  edges: [
    { id: 'schedule-stripe', source: 'schedule', target: 'stripe' },
    { id: 'schedule-sheets', source: 'schedule', target: 'sheets' },
    { id: 'stripe-reconcile', source: 'stripe', target: 'reconcile' },
    { id: 'sheets-reconcile', source: 'sheets', target: 'reconcile' },
    { id: 'reconcile-record', source: 'reconcile', target: 'record' },
    { id: 'record-digest', source: 'record', target: 'digest' },
  ],
}

/** use-cases/whatsapp-storefront-bot — FAQ answers with an escalation gate. */
export const AV_STOREFRONT_BOT_WORKFLOW: PreviewWorkflow = {
  id: 'av-storefront-bot',
  name: 'storefront-bot',
  blocks: [
    {
      id: 'whatsapptrigger',
      name: 'WhatsApp Trigger',
      type: 'whatsapp',
      bgColor: '#25D366',
      position: { x: 0, y: 130 },
      hideTargetHandle: true,
      rows: [{ title: 'Message', value: '<whatsapp.message>' }],
    },
    {
      id: 'condition',
      name: 'Refund?',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 340, y: 130 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: 'refund or complaint' },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'alertowner',
      name: 'Alert Owner',
      type: 'slack',
      bgColor: '#611F69',
      position: { x: 680, y: 0 },
      rows: [{ title: 'Channel', value: '#storefront' }],
    },
    {
      id: 'knowledge',
      name: 'Knowledge',
      type: 'knowledge',
      bgColor: '#00B0B0',
      position: { x: 680, y: 240 },
      rows: [
        { title: 'Knowledge Base', value: 'Shop FAQ' },
        { title: 'Search Query', value: '<whatsapptrigger.message>' },
      ],
    },
    {
      id: 'answer',
      name: 'Answer',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 1020, y: 240 },
      rows: [
        { title: 'Messages', value: 'Answer from <knowledge.results>' },
        { title: 'Model', value: 'claude-sonnet-5' },
        { title: 'Memory', value: 'Conversation · <whatsapptrigger.from>' },
      ],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'whatsapp',
      bgColor: '#25D366',
      position: { x: 1360, y: 240 },
      rows: [{ title: 'To', value: '<whatsapptrigger.from>' }],
    },
  ],
  edges: [
    { id: 'trigger-condition', source: 'whatsapptrigger', target: 'condition' },
    {
      id: 'condition-alertowner',
      source: 'condition',
      target: 'alertowner',
      sourceHandle: 'condition-if',
    },
    {
      id: 'condition-knowledge',
      source: 'condition',
      target: 'knowledge',
      sourceHandle: 'condition-else',
    },
    { id: 'knowledge-answer', source: 'knowledge', target: 'answer' },
    { id: 'answer-reply', source: 'answer', target: 'reply' },
  ],
}
