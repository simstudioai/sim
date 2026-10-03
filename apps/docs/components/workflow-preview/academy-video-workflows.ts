import type { PreviewWorkflow } from '@/components/workflow-preview/workflow-data'

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
      typeLabel: 'Gmail',
      isIntegration: true,
      sentence: ['Run on Gmail Email Trigger'],
      bgColor: '#E0E0E0',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Include Attachments', value: 'Enabled' }],
    },
    {
      id: 'file',
      name: 'File',
      type: 'file',
      typeLabel: 'File',
      sentence: ['Parse', { subBlockId: 'Files', noun: 'file' }],
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
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
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
      typeLabel: 'Supabase',
      isIntegration: true,
      sentence: ['Create a Row', 'in', { subBlockId: 'Table' }, 'with', { subBlockId: 'Data' }],
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
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Lead' }],
    },
    {
      id: 'qualify',
      name: 'Qualify',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
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
      typeLabel: 'Response',
      sentence: ['Return', { subBlockId: 'Data', noun: 'response' }],
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
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Customer message' }],
    },
    {
      id: 'support',
      name: 'Support',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
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
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Run' }],
    },
    {
      id: 'table',
      name: 'Table 1',
      type: 'table',
      typeLabel: 'Table',
      sentence: [
        'Query rows from',
        { subBlockId: 'Table', noun: 'table' },
        ', where',
        { subBlockId: 'Filter Conditions' },
      ],
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
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Lead' }],
    },
    {
      id: 'qualify',
      name: 'Qualify',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
        ', using',
        { subBlockId: 'Tools' },
      ],
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
      typeLabel: 'Response',
      sentence: ['Return', { subBlockId: 'Data', noun: 'response' }],
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
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Lead' }],
    },
    {
      id: 'qualify',
      name: 'Qualify',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
        ', using',
        { subBlockId: 'Tools' },
      ],
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
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 60 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Ticket' }],
    },
    {
      id: 'triage',
      name: 'Triage',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
        ', using',
        { subBlockId: 'Tools' },
      ],
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
      typeLabel: 'Condition',
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
      typeLabel: 'Slack',
      isIntegration: true,
      sentence: ['Send a message to', { subBlockId: 'Channel', noun: 'channel' }],
      bgColor: '#611F69',
      position: { x: 1000, y: -40 },
      rows: [{ title: 'Channel', value: '#support-urgent' }],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 1000, y: 160 },
      rows: [{ title: 'Messages', value: 'Draft the reply' }],
    },
    {
      id: 'log',
      name: 'Log',
      type: 'table',
      typeLabel: 'Table',
      sentence: ['Insert Row', { subBlockId: 'Table', noun: 'table' }],
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
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 95 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Idea' }],
    },
    {
      id: 'candidates',
      name: 'Candidates',
      type: 'parallel',
      typeLabel: 'Parallel',
      bgColor: '#1D1C1A',
      position: { x: 320, y: 30 },
      size: { width: 480, height: 300 },
      rows: [],
    },
    {
      id: 'writer',
      name: 'Writer',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 150, y: 64 },
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
      typeLabel: 'Evaluator',
      sentence: [
        'Score',
        { subBlockId: 'Content', noun: 'content' },
        'against',
        { subBlockId: 'Metrics', noun: 'metrics' },
      ],
      bgColor: '#8B5CF6',
      position: { x: 890, y: 95 },
      rows: [
        { title: 'Metrics', value: 'Voice · Hook' },
        { title: 'Content', value: '<writer.content>' },
      ],
    },
    {
      id: 'scores',
      name: 'Scores',
      type: 'table',
      typeLabel: 'Table',
      sentence: ['Insert Row', { subBlockId: 'Table', noun: 'table' }],
      bgColor: '#10B981',
      position: { x: 1230, y: 95 },
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
