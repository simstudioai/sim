import type { PreviewWorkflow } from '@/components/workflow-preview/workflow-data'

/**
 * The running example used across the Workflows overview: a workflow that takes
 * an incoming customer message, classifies its category and urgency, and returns
 * the result. Colors match the real Start / Agent / Response blocks.
 */
export const CLASSIFY_WORKFLOW: PreviewWorkflow = {
  id: 'classify-message',
  name: 'Classify customer message',
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
      position: { x: 340, y: 0 },
      rows: [
        { title: 'Model', value: 'claude-sonnet-5-5' },
        {
          title: 'Messages',
          value: 'Classify <start.input> into sales, support, or billing and low or high urgency.',
        },
        {
          title: 'Response Format',
          value:
            '{"name":"message_classification","schema":{"type":"object","properties":{"category":{"type":"string","enum":["sales","support","billing"]},"urgency":{"type":"string","enum":["low","high"]}},"required":["category","urgency"],"additionalProperties":false}}',
        },
      ],
    },
  ],
  edges: [{ id: 'start-agent', source: 'start', target: 'agent' }],
}

/**
 * A three-block chain used on the Data flow page: the message is classified, then
 * a reply is drafted from that classification. Shows values moving forward along
 * the chain (Reply reads Classify's output; Classify reads the Start input).
 */
export const CLASSIFY_REPLY_WORKFLOW: PreviewWorkflow = {
  id: 'classify-reply',
  name: 'Classify and reply',
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
      id: 'classify',
      name: 'Classify',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 330, y: 0 },
      rows: [
        { title: 'Model', value: 'claude-sonnet-5-5' },
        { title: 'Messages', value: 'Classify <start.input>' },
      ],
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
      position: { x: 660, y: 0 },
      rows: [
        { title: 'Model', value: 'claude-sonnet-5-5' },
        { title: 'Messages', value: 'Draft a reply for <classify.content>' },
      ],
    },
  ],
  edges: [
    { id: 'start-classify', source: 'start', target: 'classify' },
    { id: 'classify-reply', source: 'classify', target: 'reply' },
  ],
}

/**
 * A support workflow used on the "Using a knowledge base" page: a question is
 * searched against a knowledge base, and an Agent answers from the matches.
 */
export const SUPPORT_KB_WORKFLOW: PreviewWorkflow = {
  id: 'support-kb',
  name: 'Answer from docs',
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
      rows: [{ title: 'Input', value: 'Customer question' }],
    },
    {
      id: 'knowledge',
      name: 'Knowledge',
      type: 'knowledge',
      typeLabel: 'Knowledge',
      sentence: [
        'Search',
        { subBlockId: 'Knowledge Base', noun: 'knowledge base' },
        'for',
        { subBlockId: 'Query', noun: 'query' },
      ],
      bgColor: '#00B0B0',
      position: { x: 330, y: 0 },
      rows: [
        { title: 'Operation', value: 'Search' },
        { title: 'Query', value: '<start.input>' },
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
      position: { x: 660, y: 0 },
      rows: [
        { title: 'Model', value: 'claude-sonnet-5-5' },
        { title: 'Messages', value: 'Answer from <knowledge.results>' },
      ],
    },
  ],
  edges: [
    { id: 'start-knowledge', source: 'start', target: 'knowledge' },
    { id: 'knowledge-agent', source: 'knowledge', target: 'agent' },
  ],
}

/**
 * The lead-enrichment chain from the "Using tables in workflows" page: query
 * unprocessed rows, classify each with an Agent, write the result back. The
 * first Table block is named "Table 1" to match the `<table1.rows>` references
 * in the prose.
 */
export const TABLE_ENRICH_WORKFLOW: PreviewWorkflow = {
  id: 'table-enrich',
  name: 'Enrich leads',
  blocks: [
    {
      id: 'table1',
      name: 'Table 1',
      type: 'table_v2',
      typeLabel: 'Table',
      sentence: [
        'Query rows from',
        { subBlockId: 'Table', noun: 'table' },
        ', where',
        { subBlockId: 'Filter' },
      ],
      bgColor: '#10B981',
      position: { x: 0, y: 100 },
      rows: [
        { title: 'Operation', value: 'Query Rows' },
        { title: 'Filter', value: 'status = unprocessed' },
      ],
    },
    {
      id: 'loop',
      name: 'Process leads',
      type: 'loop',
      typeLabel: 'Loop',
      bgColor: '#FAFAF9',
      position: { x: 340, y: 0 },
      size: { width: 700, height: 320 },
      rows: [
        { title: 'Loop Type', value: 'For Each' },
        { title: 'Items', value: '<table1.rows>' },
      ],
    },
    {
      id: 'classify',
      name: 'Classify',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 70, y: 85 },
      parentId: 'loop',
      rows: [
        { title: 'Messages', value: 'Classify <loop.currentItem.data>' },
        {
          title: 'Response Format',
          value:
            '{"name":"lead_classification","schema":{"type":"object","properties":{"category":{"type":"string"},"score":{"type":"number"}},"required":["category","score"],"additionalProperties":false}}',
        },
      ],
    },
    {
      id: 'table2',
      name: 'Table 2',
      type: 'table_v2',
      typeLabel: 'Table',
      sentence: [
        'Update row',
        { subBlockId: 'Row ID', noun: 'row' },
        'in',
        { subBlockId: 'Table', noun: 'table' },
      ],
      bgColor: '#10B981',
      position: { x: 390, y: 85 },
      parentId: 'loop',
      rows: [
        { title: 'Operation', value: 'Update Row by ID' },
        { title: 'Row ID', value: '<loop.currentItem.id>' },
        {
          title: 'Row Data',
          value:
            '{ "category": "<classify.category>", "score": "<classify.score>", "status": "processed" }',
        },
      ],
    },
  ],
  edges: [
    { id: 'table1-loop', source: 'table1', target: 'loop' },
    { id: 'loop-classify', source: 'loop', target: 'classify', sourceHandle: 'loop-start-source' },
    { id: 'classify-table2', source: 'classify', target: 'table2' },
  ],
}

/**
 * The example on the API block page: fetch data over HTTP, then summarize the
 * response with an Agent.
 */
export const API_FETCH_WORKFLOW: PreviewWorkflow = {
  id: 'api-fetch',
  name: 'Fetch and summarize',
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
      rows: [{ title: 'Input', value: 'User ID' }],
    },
    {
      id: 'api',
      name: 'API',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#2F55FF',
      position: { x: 330, y: 0 },
      rows: [
        { title: 'Method', value: 'GET' },
        { title: 'URL', value: 'https://api.example.com/users/<start.input>' },
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
      position: { x: 660, y: 0 },
      rows: [
        { title: 'Model', value: 'claude-sonnet-5-5' },
        { title: 'Messages', value: 'Summarize <api.data>' },
      ],
    },
  ],
  edges: [
    { id: 'start-api', source: 'start', target: 'api' },
    { id: 'api-agent', source: 'api', target: 'agent' },
  ],
}

/**
 * The example on the Condition block page: route a ticket to a different path
 * based on its priority.
 */
export const CONDITION_ROUTE_WORKFLOW: PreviewWorkflow = {
  id: 'condition-route',
  name: 'Route by priority',
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
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: { x: 330, y: 60 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: "<start.priority> === 'high'" },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'escalate',
      name: 'Escalate',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 700, y: 0 },
      rows: [{ title: 'Messages', value: 'Escalate this ticket' }],
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
      position: { x: 700, y: 140 },
      rows: [{ title: 'Messages', value: 'Draft a standard reply' }],
    },
  ],
  edges: [
    { id: 'start-condition', source: 'start', target: 'condition' },
    {
      id: 'condition-escalate',
      source: 'condition',
      target: 'escalate',
      sourceHandle: 'condition-if',
    },
    { id: 'condition-reply', source: 'condition', target: 'reply', sourceHandle: 'condition-else' },
  ],
}

/** Condition example: gate publishing on a moderation score. */
export const CONDITION_MODERATE_WORKFLOW: PreviewWorkflow = {
  id: 'condition-moderate',
  name: 'Moderate content',
  blocks: [
    {
      id: 'moderate',
      name: 'Moderate',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 0, y: 60 },
      rows: [
        { title: 'Messages', value: 'Score toxicity of <start.input> from 0 to 1.' },
        {
          title: 'Response Format',
          value:
            '{"name":"moderation","schema":{"type":"object","properties":{"toxicity":{"type":"number","minimum":0,"maximum":1}},"required":["toxicity"],"additionalProperties":false}}',
        },
      ],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: { x: 330, y: 60 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<moderate.toxicity> > 0.7' },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'block',
      name: 'Block',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 700, y: 0 },
      rows: [{ title: 'Code', value: 'throw new Error("Content blocked")' }],
    },
    {
      id: 'publish',
      name: 'Publish',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#2F55FF',
      position: { x: 700, y: 140 },
      rows: [{ title: 'Method', value: 'POST' }],
    },
  ],
  edges: [
    { id: 'moderate-condition', source: 'moderate', target: 'condition' },
    { id: 'condition-block', source: 'condition', target: 'block', sourceHandle: 'condition-if' },
    {
      id: 'condition-publish',
      source: 'condition',
      target: 'publish',
      sourceHandle: 'condition-else',
    },
  ],
}

/** Function example: reshape an API response into the field a later block needs. */
export const FUNCTION_RESHAPE_WORKFLOW: PreviewWorkflow = {
  id: 'function-reshape',
  name: 'Reshape a response',
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
      rows: [{ title: 'Input', value: 'Team ID' }],
    },
    {
      id: 'api',
      name: 'API',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#2F55FF',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Method', value: 'GET' },
        { title: 'URL', value: 'https://api.example.com/teams/<start.input>/users' },
      ],
    },
    {
      id: 'extract',
      name: 'Extract',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 640, y: 0 },
      rows: [
        { title: 'Language', value: 'JavaScript' },
        {
          title: 'Code',
          value:
            'const data = <api.data>;\nreturn data.items.filter((item) => item.active).map((item) => item.id);',
        },
      ],
    },
  ],
  edges: [
    { id: 'start-api', source: 'start', target: 'api' },
    { id: 'api-extract', source: 'api', target: 'extract' },
  ],
}

/** Function example: normalize input before writing it. */
export const FUNCTION_VALIDATE_WORKFLOW: PreviewWorkflow = {
  id: 'function-validate',
  name: 'Normalize before write',
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
      rows: [{ title: 'Input', value: 'Form' }],
    },
    {
      id: 'clean',
      name: 'Clean',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Language', value: 'JavaScript' },
        {
          title: 'Code',
          value:
            'return { name: String(<start.input.name>).trim(), email: String(<start.input.email>).trim().toLowerCase() };',
        },
      ],
    },
    {
      id: 'save',
      name: 'Save',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
        ', with body',
        { subBlockId: 'Body' },
      ],
      bgColor: '#2F55FF',
      position: { x: 640, y: 0 },
      rows: [
        { title: 'Method', value: 'POST' },
        { title: 'URL', value: 'https://api.example.com/contacts' },
        { title: 'Body', value: '<clean.result>' },
      ],
    },
  ],
  edges: [
    { id: 'start-clean', source: 'start', target: 'clean' },
    { id: 'clean-save', source: 'clean', target: 'save' },
  ],
}

/** Router example: a model triages a ticket to the right team. */
export const ROUTER_TRIAGE_WORKFLOW: PreviewWorkflow = {
  id: 'router-triage',
  name: 'Triage a ticket',
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
      rows: [{ title: 'Input', value: 'Ticket' }],
    },
    {
      id: 'router',
      name: 'Router',
      type: 'router',
      typeLabel: 'Router',
      bgColor: '#28C43F',
      position: { x: 320, y: 95 },
      rows: [
        { title: 'Context', value: '<start.input>' },
        { title: 'Model', value: 'claude-sonnet-5-5' },
      ],
      branches: [
        { id: 'router-sales', label: 'Sales' },
        { id: 'router-support', label: 'Support' },
        { id: 'router-billing', label: 'Billing' },
      ],
    },
    {
      id: 'sales',
      name: 'Sales',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 700, y: 0 },
      rows: [{ title: 'Messages', value: 'Answer the pricing question' }],
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
      position: { x: 700, y: 140 },
      rows: [{ title: 'Messages', value: 'Help with the issue' }],
    },
    {
      id: 'billing',
      name: 'Billing',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 700, y: 280 },
      rows: [{ title: 'Messages', value: 'Resolve the billing question' }],
    },
  ],
  edges: [
    { id: 'start-router', source: 'start', target: 'router' },
    { id: 'router-sales', source: 'router', target: 'sales', sourceHandle: 'router-sales' },
    { id: 'router-support', source: 'router', target: 'support', sourceHandle: 'router-support' },
    { id: 'router-billing', source: 'router', target: 'billing', sourceHandle: 'router-billing' },
  ],
}

/** Response example: return a structured answer from an API-triggered workflow. */
export const RESPONSE_API_WORKFLOW: PreviewWorkflow = {
  id: 'response-api',
  name: 'Answer over the API',
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
      rows: [{ title: 'Input', value: 'Question' }],
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
      position: { x: 320, y: 0 },
      rows: [{ title: 'Messages', value: 'Answer <start.input>' }],
    },
    {
      id: 'response',
      name: 'Response',
      type: 'response',
      typeLabel: 'Response',
      sentence: [
        'Return',
        { subBlockId: 'Data', noun: 'response' },
        'with status',
        { subBlockId: 'Status' },
      ],
      bgColor: '#2F55FF',
      position: { x: 640, y: 0 },
      rows: [
        { title: 'Data', value: '{ "answer": "<agent.content>" }' },
        { title: 'Status', value: '200' },
      ],
    },
  ],
  edges: [
    { id: 'start-agent', source: 'start', target: 'agent' },
    { id: 'agent-response', source: 'agent', target: 'response' },
  ],
}

/** Router example: classify incoming feedback into the right child workflow. */
export const ROUTER_CLASSIFY_WORKFLOW: PreviewWorkflow = {
  id: 'router-classify',
  name: 'Classify feedback',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 50 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Feedback' }],
    },
    {
      id: 'router',
      name: 'Router',
      type: 'router',
      typeLabel: 'Router',
      bgColor: '#28C43F',
      position: { x: 320, y: 50 },
      rows: [{ title: 'Context', value: '<start.input>' }],
      branches: [
        { id: 'router-product', label: 'Product' },
        { id: 'router-bug', label: 'Bug report' },
      ],
    },
    {
      id: 'product',
      name: 'Product',
      type: 'workflow_input',
      typeLabel: 'Workflow',
      sentence: ['Run', { subBlockId: 'Workflow', noun: 'workflow' }],
      bgColor: '#6366F1',
      position: { x: 700, y: 0 },
      rows: [
        { title: 'Workflow', value: 'product-intake' },
        { title: 'Inputs', value: 'input = <start.input>' },
      ],
    },
    {
      id: 'bug',
      name: 'Bug report',
      type: 'workflow_input',
      typeLabel: 'Workflow',
      sentence: ['Run', { subBlockId: 'Workflow', noun: 'workflow' }],
      bgColor: '#6366F1',
      position: { x: 700, y: 140 },
      rows: [
        { title: 'Workflow', value: 'bug-triage' },
        { title: 'Inputs', value: 'input = <start.input>' },
      ],
    },
  ],
  edges: [
    { id: 'start-router', source: 'start', target: 'router' },
    { id: 'router-product', source: 'router', target: 'product', sourceHandle: 'router-product' },
    { id: 'router-bug', source: 'router', target: 'bug', sourceHandle: 'router-bug' },
  ],
}

/** Response example: return a different status on each branch. */
export const RESPONSE_ERROR_WORKFLOW: PreviewWorkflow = {
  id: 'response-error',
  name: 'Status per branch',
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
      rows: [{ title: 'Input', value: 'Request' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: { x: 320, y: 60 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<start.valid>' },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'ok',
      name: 'Success response',
      type: 'response',
      typeLabel: 'Response',
      sentence: [
        'Return',
        { subBlockId: 'Data', noun: 'response' },
        'with status',
        { subBlockId: 'Status' },
      ],
      bgColor: '#2F55FF',
      position: { x: 700, y: 0 },
      rows: [{ title: 'Status', value: '200' }],
    },
    {
      id: 'bad',
      name: 'Invalid response',
      type: 'response',
      typeLabel: 'Response',
      sentence: [
        'Return',
        { subBlockId: 'Data', noun: 'response' },
        'with status',
        { subBlockId: 'Status' },
      ],
      bgColor: '#2F55FF',
      position: { x: 700, y: 140 },
      rows: [{ title: 'Status', value: '400' }],
    },
  ],
  edges: [
    { id: 'start-condition', source: 'start', target: 'condition' },
    { id: 'condition-ok', source: 'condition', target: 'ok', sourceHandle: 'condition-if' },
    { id: 'condition-bad', source: 'condition', target: 'bad', sourceHandle: 'condition-else' },
  ],
}

/** Variables example: count retries across attempts. */
export const VARIABLES_RETRY_WORKFLOW: PreviewWorkflow = {
  id: 'variables-retry',
  name: 'Count retry attempts',
  blocks: [
    {
      id: 'attempts',
      name: 'Retry attempts',
      type: 'loop',
      typeLabel: 'Loop',
      bgColor: '#FAFAF9',
      position: {
        x: 300,
        y: 0,
      },
      rows: [
        {
          title: 'Loop Type',
          value: 'While Loop',
        },
        {
          title: 'While Condition',
          value: '<variable.retryCount> < 3',
        },
      ],
      size: {
        width: 1060,
        height: 450,
      },
    },
    {
      id: 'attempt',
      name: 'Attempt',
      type: 'api',
      typeLabel: 'API',
      bgColor: '#2F55FF',
      position: {
        x: 70,
        y: 90,
      },
      rows: [
        {
          title: 'Method',
          value: 'GET',
        },
        {
          title: 'URL',
          value: 'https://api.example.com/job',
        },
      ],
      parentId: 'attempts',
    },
    {
      id: 'done',
      name: 'Finish retries',
      type: 'variables',
      typeLabel: 'Variables',
      bgColor: '#8B5CF6',
      position: {
        x: 700,
        y: 30,
      },
      rows: [
        {
          title: 'Variable Assignments',
          value: 'retryCount = 3',
        },
      ],
      parentId: 'attempts',
    },
    {
      id: 'increment',
      name: 'Increment',
      type: 'function',
      typeLabel: 'Function',
      bgColor: '#FF402F',
      position: {
        x: 380,
        y: 230,
      },
      rows: [
        {
          title: 'Code',
          value: 'return <variable.retryCount> + 1;',
        },
      ],
      parentId: 'attempts',
    },
    {
      id: 'assign',
      name: 'Update counter',
      type: 'variables',
      typeLabel: 'Variables',
      bgColor: '#8B5CF6',
      position: {
        x: 700,
        y: 230,
      },
      rows: [
        {
          title: 'Variable Assignments',
          value: 'retryCount = <increment.result>',
        },
      ],
      parentId: 'attempts',
    },
  ],
  edges: [
    {
      id: 'attempts-attempt',
      source: 'attempts',
      target: 'attempt',
      sourceHandle: 'loop-start-source',
    },
    {
      id: 'attempt-done',
      source: 'attempt',
      target: 'done',
    },
    {
      id: 'attempt-increment',
      source: 'attempt',
      target: 'increment',
      sourceHandle: 'error',
    },
    {
      id: 'increment-assign',
      source: 'increment',
      target: 'assign',
    },
  ],
}

/** Variables example: hold fetched config for the rest of the run. */
export const VARIABLES_CONFIG_WORKFLOW: PreviewWorkflow = {
  id: 'variables-config',
  name: 'Hold config',
  blocks: [
    {
      id: 'api',
      name: 'API',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#2F55FF',
      position: { x: 0, y: 0 },
      rows: [
        { title: 'URL', value: 'https://api.example.com/profile' },
        { title: 'Method', value: 'GET' },
      ],
    },
    {
      id: 'vars',
      name: 'Variables',
      type: 'variables',
      typeLabel: 'Variables',
      sentence: ['Set', { subBlockId: 'Set', noun: 'variables' }],
      bgColor: '#8B5CF6',
      position: { x: 320, y: 0 },
      rows: [{ title: 'Set', value: 'userId = <api.data.id>, userTier = <api.data.tier>' }],
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
      position: { x: 640, y: 0 },
      rows: [{ title: 'Messages', value: 'Personalize for <variable.userTier>' }],
    },
  ],
  edges: [
    { id: 'api-vars', source: 'api', target: 'vars' },
    { id: 'vars-agent', source: 'vars', target: 'agent' },
  ],
}

/** Wait example: space out two API calls to respect a rate limit. */
export const WAIT_RATELIMIT_WORKFLOW: PreviewWorkflow = {
  id: 'wait-ratelimit',
  name: 'Space out calls',
  blocks: [
    {
      id: 'first',
      name: 'API',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#2F55FF',
      position: { x: 0, y: 0 },
      rows: [{ title: 'Method', value: 'GET' }],
    },
    {
      id: 'wait',
      name: 'Wait',
      type: 'wait',
      typeLabel: 'Wait',
      sentence: ['Pause for', { subBlockId: 'Amount', noun: 'amount' }, { subBlockId: 'Unit' }],
      bgColor: '#F59E0B',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Amount', value: '2' },
        { title: 'Unit', value: 'Seconds' },
      ],
    },
    {
      id: 'second',
      name: 'API',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#2F55FF',
      position: { x: 640, y: 0 },
      rows: [{ title: 'Method', value: 'GET' }],
    },
  ],
  edges: [
    { id: 'first-wait', source: 'first', target: 'wait' },
    { id: 'wait-second', source: 'wait', target: 'second' },
  ],
}

/** Wait example: send a follow-up after a delay. */
export const WAIT_FOLLOWUP_WORKFLOW: PreviewWorkflow = {
  id: 'wait-followup',
  name: 'Delayed follow-up',
  blocks: [
    {
      id: 'send',
      name: 'Send',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 0, y: 0 },
      rows: [{ title: 'Messages', value: 'Send the welcome email' }],
    },
    {
      id: 'wait',
      name: 'Wait',
      type: 'wait',
      typeLabel: 'Wait',
      sentence: ['Pause for', { subBlockId: 'Amount', noun: 'amount' }, { subBlockId: 'Unit' }],
      bgColor: '#F59E0B',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Amount', value: '2' },
        { title: 'Unit', value: 'Days' },
        { title: 'Async', value: 'On' },
      ],
    },
    {
      id: 'followup',
      name: 'Follow up',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 640, y: 0 },
      rows: [{ title: 'Messages', value: 'Send a check-in' }],
    },
  ],
  edges: [
    { id: 'send-wait', source: 'send', target: 'wait' },
    { id: 'wait-followup', source: 'wait', target: 'followup' },
  ],
}

/** Evaluator example: gate a draft on a quality score before it ships. */
export const EVALUATOR_GATE_WORKFLOW: PreviewWorkflow = {
  id: 'evaluator-gate',
  name: 'Gate on a score',
  blocks: [
    {
      id: 'draft',
      name: 'Draft',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 0, y: 0 },
      rows: [{ title: 'Messages', value: 'Write the announcement' }],
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
      bgColor: '#4D5FFF',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Metrics', value: 'Accuracy, Clarity' },
        { title: 'Model', value: 'claude-sonnet-5-5' },
      ],
    },
    {
      id: 'gate',
      name: 'Condition',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: { x: 640, y: 0 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<evaluator.accuracy> >= 4' },
        { id: 'condition-else', label: 'else' },
      ],
    },
  ],
  edges: [
    { id: 'draft-evaluator', source: 'draft', target: 'evaluator' },
    { id: 'evaluator-gate', source: 'evaluator', target: 'gate' },
  ],
}

/** Credential example: select one Slack account and reuse it across compatible actions. */
export const CREDENTIAL_SHARE_WORKFLOW: PreviewWorkflow = {
  id: 'credential-share',
  name: 'Share a credential',
  blocks: [
    {
      id: 'credential',
      name: 'Credential',
      type: 'credential',
      typeLabel: 'Credential',
      sentence: ['Select an OAuth credential', 'for', { subBlockId: 'Account' }],
      bgColor: '#6366F1',
      position: { x: 0, y: 100 },
      rows: [
        { title: 'Operation', value: 'Select Credential' },
        { title: 'Account', value: 'Slack' },
      ],
    },
    {
      id: 'send',
      name: 'Send message',
      type: 'slack',
      typeLabel: 'Slack',
      isIntegration: true,
      sentence: ['Use account', { subBlockId: 'Account', noun: 'account' }],
      bgColor: '#FFFFFF',
      position: { x: 380, y: 0 },
      rows: [{ title: 'Account', value: '<credential.credentialId>' }],
    },
    {
      id: 'read',
      name: 'Read channel',
      type: 'slack',
      typeLabel: 'Slack',
      isIntegration: true,
      sentence: ['Use account', { subBlockId: 'Account', noun: 'account' }],
      bgColor: '#FFFFFF',
      position: { x: 380, y: 140 },
      rows: [{ title: 'Account', value: '<credential.credentialId>' }],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'slack',
      typeLabel: 'Slack',
      isIntegration: true,
      sentence: ['Use account', { subBlockId: 'Account', noun: 'account' }],
      bgColor: '#FFFFFF',
      position: { x: 380, y: 280 },
      rows: [{ title: 'Account', value: '<credential.credentialId>' }],
    },
  ],
  edges: [
    { id: 'credential-gmail', source: 'credential', target: 'send' },
    { id: 'credential-drive', source: 'credential', target: 'read' },
    { id: 'credential-calendar', source: 'credential', target: 'reply' },
  ],
}

/** Credential example: pick a production or staging account at runtime. */
export const CREDENTIAL_ROUTE_WORKFLOW: PreviewWorkflow = {
  id: 'credential-route',
  name: 'Choose a Slack account',
  blocks: [
    {
      id: 'condition',
      name: 'Choose account',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: {
        x: 300,
        y: 60,
      },
      rows: [],
      branches: [
        {
          id: 'condition-if',
          label: 'If',
          value: "<variable.env> === 'prod'",
        },
        {
          id: 'condition-else',
          label: 'else',
        },
      ],
    },
    {
      id: 'prod',
      name: 'Production account',
      type: 'credential',
      typeLabel: 'Credential',
      bgColor: '#6366F1',
      position: {
        x: 610,
        y: 0,
      },
      rows: [
        {
          title: 'Operation',
          value: 'Select Credential',
        },
        {
          title: 'Credential',
          value: 'Prod Slack',
        },
      ],
    },
    {
      id: 'staging',
      name: 'Staging account',
      type: 'credential',
      typeLabel: 'Credential',
      bgColor: '#6366F1',
      position: {
        x: 610,
        y: 180,
      },
      rows: [
        {
          title: 'Operation',
          value: 'Select Credential',
        },
        {
          title: 'Credential',
          value: 'Staging Slack',
        },
      ],
    },
    {
      id: 'postprod',
      name: 'Production message',
      type: 'slack',
      typeLabel: 'Slack',
      bgColor: '#FFFFFF',
      position: {
        x: 930,
        y: 0,
      },
      rows: [
        {
          title: 'Operation',
          value: 'Send Message',
        },
        {
          title: 'Credential',
          value: '<productionaccount.credentialId>',
        },
      ],
      isIntegration: true,
    },
    {
      id: 'poststaging',
      name: 'Staging message',
      type: 'slack',
      typeLabel: 'Slack',
      bgColor: '#FFFFFF',
      position: {
        x: 930,
        y: 180,
      },
      rows: [
        {
          title: 'Operation',
          value: 'Send Message',
        },
        {
          title: 'Credential',
          value: '<stagingaccount.credentialId>',
        },
      ],
      isIntegration: true,
    },
  ],
  edges: [
    {
      id: 'condition-prod',
      source: 'condition',
      target: 'prod',
      sourceHandle: 'condition-if',
    },
    {
      id: 'condition-staging',
      source: 'condition',
      target: 'staging',
      sourceHandle: 'condition-else',
    },
    {
      id: 'prod-postprod',
      source: 'prod',
      target: 'postprod',
    },
    {
      id: 'staging-poststaging',
      source: 'staging',
      target: 'poststaging',
    },
  ],
}

const GUARDRAILS_START = {
  id: 'start',
  name: 'Agent',
  type: 'agent',
  typeLabel: 'Agent',
  sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }, 'with', { subBlockId: 'Messages' }],
  bgColor: '#33C482',
  position: { x: 0, y: 0 },
} as const

const GUARDRAILS_GATE = {
  id: 'condition',
  name: 'Condition',
  type: 'condition',
  typeLabel: 'Condition',
  bgColor: '#FF752F',
  position: { x: 640, y: 0 },
} as const

/** Guardrails example: validate JSON before parsing it. */
export const GUARDRAILS_JSON_WORKFLOW: PreviewWorkflow = {
  id: 'guardrails-json',
  name: 'Validate JSON',
  blocks: [
    { ...GUARDRAILS_START, rows: [{ title: 'Messages', value: 'Return JSON' }] },
    {
      id: 'guardrails',
      name: 'Guardrails',
      type: 'guardrails',
      typeLabel: 'Guardrails',
      sentence: ['Validate content using', { subBlockId: 'Validation', noun: 'validation type' }],
      bgColor: '#3D642D',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Content to Validate', value: '<agent.content>' },
        { title: 'Validation', value: 'Valid JSON' },
      ],
    },
    {
      ...GUARDRAILS_GATE,
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<guardrails.passed>' },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'parse',
      name: 'Parse',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 960, y: -60 },
      rows: [{ title: 'Code', value: 'return JSON.parse(<agent.content>);' }],
    },
    {
      id: 'reject',
      name: 'Reject',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 960, y: 140 },
      rows: [{ title: 'Code', value: 'return { valid: false, error: <guardrails.error> };' }],
    },
  ],
  edges: [
    { id: 'start-guardrails', source: 'start', target: 'guardrails' },
    { id: 'guardrails-condition', source: 'guardrails', target: 'condition' },
    { id: 'condition-parse', source: 'condition', target: 'parse', sourceHandle: 'condition-if' },
    {
      id: 'condition-reject',
      source: 'condition',
      target: 'reject',
      sourceHandle: 'condition-else',
    },
  ],
}

/** Guardrails example: check an answer is grounded in the knowledge base. */
export const GUARDRAILS_HALLUCINATION_WORKFLOW: PreviewWorkflow = {
  id: 'guardrails-hallucination',
  name: 'Check grounding',
  blocks: [
    { ...GUARDRAILS_START, rows: [{ title: 'Messages', value: 'Answer from the docs' }] },
    {
      id: 'guardrails',
      name: 'Guardrails',
      type: 'guardrails',
      typeLabel: 'Guardrails',
      sentence: [
        'Validate content using',
        { subBlockId: 'Validation', noun: 'validation type' },
        ', grounded in',
        { subBlockId: 'Knowledge Base' },
      ],
      bgColor: '#3D642D',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Content to Validate', value: '<agent.content>' },
        { title: 'Validation', value: 'Hallucination' },
        { title: 'Knowledge Base', value: 'docs' },
        { title: 'Model', value: 'claude-sonnet-5-5' },
      ],
    },
    {
      ...GUARDRAILS_GATE,
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<guardrails.score> >= 3' },
        { id: 'condition-else', label: 'else' },
      ],
    },
  ],
  edges: [
    { id: 'start-guardrails', source: 'start', target: 'guardrails' },
    { id: 'guardrails-condition', source: 'guardrails', target: 'condition' },
  ],
}

/** Guardrails example: block user input that contains PII. */
export const GUARDRAILS_PII_WORKFLOW: PreviewWorkflow = {
  id: 'guardrails-pii',
  name: 'Block PII',
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
      rows: [{ title: 'Input', value: 'User message' }],
    },
    {
      id: 'guardrails',
      name: 'Guardrails',
      type: 'guardrails',
      typeLabel: 'Guardrails',
      sentence: ['Validate content using', { subBlockId: 'Validation', noun: 'validation type' }],
      bgColor: '#3D642D',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Content to Validate', value: '<start.input>' },
        { title: 'Validation', value: 'PII Detection' },
        { title: 'Action', value: 'Block Request' },
      ],
    },
    {
      ...GUARDRAILS_GATE,
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: '<guardrails.passed>' },
        { id: 'condition-else', label: 'else' },
      ],
    },
  ],
  edges: [
    { id: 'start-guardrails', source: 'start', target: 'guardrails' },
    { id: 'guardrails-condition', source: 'guardrails', target: 'condition' },
  ],
}

/** HITL example: a human approves AI content before it ships. */
export const HITL_APPROVAL_WORKFLOW: PreviewWorkflow = {
  id: 'hitl-approval',
  name: 'Approve before publishing',
  blocks: [
    {
      id: 'draft',
      name: 'Draft',
      type: 'agent',
      typeLabel: 'Agent',
      bgColor: '#33C482',
      position: {
        x: 0,
        y: 70,
      },
      rows: [
        {
          title: 'Messages',
          value: 'Write the post',
        },
      ],
    },
    {
      id: 'approve',
      name: 'Approval',
      type: 'human_in_the_loop_v2',
      typeLabel: 'Human',
      bgColor: '#10B981',
      position: {
        x: 300,
        y: 70,
      },
      rows: [
        {
          title: 'Display Data',
          value: '<draft.content>',
        },
        {
          title: 'Resume Form',
          value: 'approved (boolean)',
        },
      ],
    },
    {
      id: 'check',
      name: 'Check approval',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: {
        x: 620,
        y: 70,
      },
      rows: [],
      branches: [
        {
          id: 'condition-if',
          label: 'If',
          value: '<approval.approved> === true',
        },
        {
          id: 'condition-else',
          label: 'else',
        },
      ],
    },
    {
      id: 'publish',
      name: 'Publish',
      type: 'api',
      typeLabel: 'API',
      bgColor: '#2F55FF',
      position: {
        x: 950,
        y: 0,
      },
      rows: [
        {
          title: 'Method',
          value: 'POST',
        },
        {
          title: 'Body',
          value: '{"content":"<draft.content>"}',
        },
      ],
    },
    {
      id: 'reject',
      name: 'Rejected',
      type: 'function',
      typeLabel: 'Function',
      bgColor: '#FF402F',
      position: {
        x: 950,
        y: 180,
      },
      rows: [
        {
          title: 'Code',
          value: 'return { approved: false };',
        },
      ],
    },
  ],
  edges: [
    {
      id: 'draft-approve',
      source: 'draft',
      target: 'approve',
    },
    {
      id: 'approve-check',
      source: 'approve',
      target: 'check',
    },
    {
      id: 'check-publish',
      source: 'check',
      target: 'publish',
      sourceHandle: 'condition-if',
    },
    {
      id: 'check-reject',
      source: 'check',
      target: 'reject',
      sourceHandle: 'condition-else',
    },
  ],
}

/** HITL example: chain two approvals for a high-stakes change. */
export const HITL_MULTISTAGE_WORKFLOW: PreviewWorkflow = {
  id: 'hitl-multistage',
  name: 'Two-stage approval',
  blocks: [
    {
      id: 'draft',
      name: 'Draft',
      type: 'agent',
      typeLabel: 'Agent',
      bgColor: '#33C482',
      position: {
        x: 0,
        y: 70,
      },
      rows: [
        {
          title: 'Messages',
          value: 'Write the post',
        },
      ],
    },
    {
      id: 'manager',
      name: 'Manager',
      type: 'human_in_the_loop_v2',
      typeLabel: 'Human',
      bgColor: '#10B981',
      position: {
        x: 300,
        y: 90,
      },
      rows: [
        {
          title: 'Display Data',
          value: '<draft.content>',
        },
        {
          title: 'Resume Form',
          value: 'approved (boolean)',
        },
      ],
    },
    {
      id: 'managergate',
      name: 'Check manager',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: {
        x: 620,
        y: 90,
      },
      rows: [],
      branches: [
        {
          id: 'condition-if',
          label: 'If',
          value: '<manager.approved> === true',
        },
        {
          id: 'condition-else',
          label: 'else',
        },
      ],
    },
    {
      id: 'director',
      name: 'Director',
      type: 'human_in_the_loop_v2',
      typeLabel: 'Human',
      bgColor: '#10B981',
      position: {
        x: 950,
        y: 0,
      },
      rows: [
        {
          title: 'Display Data',
          value: '<draft.content>',
        },
        {
          title: 'Resume Form',
          value: 'approved (boolean)',
        },
      ],
    },
    {
      id: 'directorgate',
      name: 'Check director',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: {
        x: 1280,
        y: 0,
      },
      rows: [],
      branches: [
        {
          id: 'condition-if',
          label: 'If',
          value: '<director.approved> === true',
        },
        {
          id: 'condition-else',
          label: 'else',
        },
      ],
    },
    {
      id: 'execute',
      name: 'Execute',
      type: 'function',
      typeLabel: 'Function',
      bgColor: '#FF402F',
      position: {
        x: 1610,
        y: -80,
      },
      rows: [
        {
          title: 'Code',
          value: 'return { approved: true, content: <draft.content> };',
        },
      ],
    },
    {
      id: 'managerreject',
      name: 'Manager rejected',
      type: 'function',
      typeLabel: 'Function',
      bgColor: '#FF402F',
      position: {
        x: 950,
        y: 230,
      },
      rows: [
        {
          title: 'Code',
          value: 'return { approved: false, reviewer: "manager" };',
        },
      ],
    },
    {
      id: 'directorreject',
      name: 'Director rejected',
      type: 'function',
      typeLabel: 'Function',
      bgColor: '#FF402F',
      position: {
        x: 1610,
        y: 100,
      },
      rows: [
        {
          title: 'Code',
          value: 'return { approved: false, reviewer: "director" };',
        },
      ],
    },
  ],
  edges: [
    {
      id: 'draft-manager',
      source: 'draft',
      target: 'manager',
    },
    {
      id: 'manager-managergate',
      source: 'manager',
      target: 'managergate',
    },
    {
      id: 'managergate-director',
      source: 'managergate',
      target: 'director',
      sourceHandle: 'condition-if',
    },
    {
      id: 'managergate-managerreject',
      source: 'managergate',
      target: 'managerreject',
      sourceHandle: 'condition-else',
    },
    {
      id: 'director-directorgate',
      source: 'director',
      target: 'directorgate',
    },
    {
      id: 'directorgate-execute',
      source: 'directorgate',
      target: 'execute',
      sourceHandle: 'condition-if',
    },
    {
      id: 'directorgate-directorreject',
      source: 'directorgate',
      target: 'directorreject',
      sourceHandle: 'condition-else',
    },
  ],
}

/** HITL example: a human verifies extracted data before processing. */
export const HITL_VALIDATE_WORKFLOW: PreviewWorkflow = {
  id: 'hitl-validate',
  name: 'Verify before processing',
  blocks: [
    {
      id: 'extract',
      name: 'Extract',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 0, y: 0 },
      rows: [{ title: 'Messages', value: 'Extract the fields' }],
    },
    {
      id: 'validate',
      name: 'Review data',
      type: 'human_in_the_loop_v2',
      typeLabel: 'Human',
      sentence: ['Pause execution until a human responds'],
      bgColor: '#10B981',
      position: { x: 300, y: 0 },
      rows: [
        { title: 'Display Data', value: '<extract.content>' },
        { title: 'Resume Form', value: 'corrected (object)' },
      ],
    },
    {
      id: 'process',
      name: 'Process',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 640, y: 0 },
      rows: [{ title: 'Code', value: 'return <reviewdata.corrected>;' }],
    },
  ],
  edges: [
    { id: 'extract-validate', source: 'extract', target: 'validate' },
    { id: 'validate-process', source: 'validate', target: 'process' },
  ],
}

/** Webhook example: post a formatted result to an external endpoint. */
export const WEBHOOK_NOTIFY_WORKFLOW: PreviewWorkflow = {
  id: 'webhook-notify',
  name: 'Notify a service',
  blocks: [
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
      position: { x: 0, y: 0 },
      rows: [{ title: 'Messages', value: 'Summarize the run' }],
    },
    {
      id: 'format',
      name: 'Format',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 320, y: 0 },
      rows: [{ title: 'Code', value: 'return { text: <agent.content> };' }],
    },
    {
      id: 'webhook',
      name: 'Webhook',
      type: 'webhook',
      typeLabel: 'Webhook',
      sentence: [
        'Post',
        { subBlockId: 'Payload', noun: 'payload' },
        'to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#10B981',
      position: { x: 640, y: 0 },
      rows: [
        { title: 'URL', value: 'https://hooks.slack.com/services/YOUR/WEBHOOK/SECRET' },
        { title: 'Payload', value: '<format.result>' },
      ],
    },
  ],
  edges: [
    { id: 'agent-format', source: 'agent', target: 'format' },
    { id: 'format-webhook', source: 'format', target: 'webhook' },
  ],
}

/** Webhook example: fire an external process when a check passes. */
export const WEBHOOK_TRIGGER_WORKFLOW: PreviewWorkflow = {
  id: 'webhook-trigger',
  name: 'Trigger on a check',
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
      rows: [{ title: 'Input', value: 'Event' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: { x: 320, y: 0 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: "<start.status> === 'done'" },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'webhook',
      name: 'Webhook',
      type: 'webhook',
      typeLabel: 'Webhook',
      sentence: [
        'Post',
        { subBlockId: 'Payload', noun: 'payload' },
        'to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#10B981',
      position: { x: 640, y: 0 },
      rows: [{ title: 'URL', value: 'https://api.example.com/hook' }],
    },
  ],
  edges: [
    { id: 'start-condition', source: 'start', target: 'condition' },
    {
      id: 'condition-webhook',
      source: 'condition',
      target: 'webhook',
      sourceHandle: 'condition-if',
    },
  ],
}

/** Workflow-block example: call a child workflow and use its result. */
export const WORKFLOW_CALL_WORKFLOW: PreviewWorkflow = {
  id: 'workflow-call',
  name: 'Call a child workflow',
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
      id: 'child',
      name: 'Workflow',
      type: 'workflow_input',
      typeLabel: 'Workflow',
      sentence: [
        'Run',
        { subBlockId: 'Workflow', noun: 'workflow' },
        ', passing',
        { subBlockId: 'Inputs' },
      ],
      bgColor: '#6366F1',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Workflow', value: 'enrich-lead' },
        { title: 'Inputs', value: 'input = <start.input>' },
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
      position: { x: 640, y: 0 },
      rows: [{ title: 'Messages', value: 'Summarize <workflow.result>' }],
    },
  ],
  edges: [
    { id: 'start-child', source: 'start', target: 'child' },
    { id: 'child-agent', source: 'child', target: 'agent' },
  ],
}

/** Loop example: run a block once per item, then use the collected results. */
export const LOOP_WORKFLOW: PreviewWorkflow = {
  id: 'loop-foreach',
  name: 'Score each review',
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
      rows: [{ title: 'Input', value: 'reviews (array)' }],
    },
    {
      id: 'loop',
      name: 'Process Reviews',
      type: 'loop',
      typeLabel: 'Loop',
      bgColor: '#FAFAF9',
      position: { x: 340, y: 30 },
      size: { width: 480, height: 300 },
      rows: [
        { title: 'Loop Type', value: 'For Each' },
        { title: 'Collection Items', value: '<start.reviews>' },
      ],
    },
    {
      id: 'score',
      name: 'Score',
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
      parentId: 'loop',
      rows: [{ title: 'Messages', value: 'Rate <loop.currentItem>' }],
    },
    {
      id: 'summary',
      name: 'Summary',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: [
        'Prompt',
        { subBlockId: 'Model', noun: 'model' },
        'with',
        { subBlockId: 'Messages' },
      ],
      bgColor: '#33C482',
      position: { x: 910, y: 95 },
      rows: [{ title: 'Messages', value: 'Summarize <processreviews.results>' }],
    },
  ],
  edges: [
    { id: 'start-loop', source: 'start', target: 'loop' },
    { id: 'loop-score', source: 'loop', target: 'score', sourceHandle: 'loop-start-source' },
    { id: 'loop-summary', source: 'loop', target: 'summary' },
  ],
}

/** Parallel example: process every item concurrently, then aggregate the results. */
export const PARALLEL_WORKFLOW: PreviewWorkflow = {
  id: 'parallel-collection',
  name: 'Process tasks in parallel',
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
      rows: [{ title: 'Input', value: 'tasks (array)' }],
    },
    {
      id: 'parallel',
      name: 'Process Tasks',
      type: 'parallel',
      typeLabel: 'Parallel',
      bgColor: '#1D1C1A',
      position: { x: 340, y: 30 },
      size: { width: 480, height: 300 },
      rows: [
        { title: 'Parallel Type', value: 'Parallel Each' },
        { title: 'Parallel Items', value: '<start.tasks>' },
        { title: 'Parallel Batch Size', value: '20' },
      ],
    },
    {
      id: 'call',
      name: 'Call',
      type: 'api',
      typeLabel: 'API',
      sentence: [
        'Send',
        { subBlockId: 'Method', noun: 'method' },
        'request to',
        { subBlockId: 'URL', noun: 'URL' },
      ],
      bgColor: '#2F55FF',
      position: { x: 150, y: 64 },
      parentId: 'parallel',
      rows: [{ title: 'URL', value: 'https://api.example.com/tasks/<parallel.currentItem>' }],
    },
    {
      id: 'aggregate',
      name: 'Aggregate',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 910, y: 95 },
      rows: [
        {
          title: 'Code',
          value: 'return <processtasks.results>.flat().map((output) => output.data);',
        },
      ],
    },
  ],
  edges: [
    { id: 'start-parallel', source: 'start', target: 'parallel' },
    {
      id: 'parallel-call',
      source: 'parallel',
      target: 'call',
      sourceHandle: 'parallel-start-source',
    },
    { id: 'parallel-aggregate', source: 'parallel', target: 'aggregate' },
  ],
}

/** Building-agents overview: a minimal agent — the Agent block as the reasoning core. */
export const BUILD_AGENT_WORKFLOW: PreviewWorkflow = {
  id: 'build-agent',
  name: 'A minimal agent',
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
      id: 'agent',
      name: 'Agent',
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
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Messages', value: 'Score <start.input> from 0 to 100.' },
        {
          title: 'Response Format',
          value:
            '{"name":"lead_score","schema":{"type":"object","properties":{"score":{"type":"number","minimum":0,"maximum":100}},"required":["score"],"additionalProperties":false}}',
        },
        { title: 'Model', value: 'claude-sonnet-5-5' },
      ],
      tools: [
        { type: 'knowledge', name: 'Knowledge', bgColor: '#00B0B0' },
        { type: 'hubspot', name: 'HubSpot', bgColor: '#FF7A59' },
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
      rows: [{ title: 'Data', value: '{ "score": <agent.score> }' }],
    },
  ],
  edges: [
    { id: 'start-agent', source: 'start', target: 'agent' },
    { id: 'agent-response', source: 'agent', target: 'response' },
  ],
}

/** Files guide: read a file, summarize it, save the summary as a new file. */
export const FILE_SUMMARY_WORKFLOW: PreviewWorkflow = {
  id: 'file-summary',
  name: 'Summarize a file',
  blocks: [
    {
      id: 'file',
      name: 'File',
      type: 'file',
      typeLabel: 'File',
      sentence: ['Read', { subBlockId: 'File', noun: 'file' }],
      bgColor: '#40916C',
      position: { x: 0, y: 0 },
      rows: [
        { title: 'Operation', value: 'Read' },
        { title: 'File', value: 'report.pdf' },
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
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Messages', value: 'Summarize this document' },
        { title: 'Files', value: '<file.files[0]>' },
      ],
    },
    {
      id: 'write',
      name: 'Save summary',
      type: 'file',
      typeLabel: 'File',
      sentence: ['Create', { subBlockId: 'File Name', noun: 'file name' }],
      bgColor: '#40916C',
      position: { x: 660, y: 0 },
      rows: [
        { title: 'Operation', value: 'Write' },
        { title: 'File Name', value: 'summary.md' },
        { title: 'Content', value: '<agent.content>' },
      ],
    },
  ],
  edges: [
    { id: 'file-agent', source: 'file', target: 'agent' },
    { id: 'agent-write', source: 'agent', target: 'write' },
  ],
}

/**
 * The running example of the choosing guide: a lead scorer combining a
 * fixed Workflow step (Enrich), a Function, an Agent with tools,
 * and a fixed Google Sheets append.
 */
export const LEAD_SCORER_WORKFLOW: PreviewWorkflow = {
  id: 'lead-scorer',
  name: 'Lead scorer',
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
      id: 'enrich',
      name: 'Enrich',
      type: 'workflow_input',
      typeLabel: 'Workflow',
      sentence: ['Run', { subBlockId: 'Workflow', noun: 'workflow' }],
      bgColor: '#6366F1',
      position: { x: 290, y: 0 },
      rows: [
        { title: 'Workflow', value: 'enrich-lead' },
        { title: 'Inputs', value: 'input = <start.input>' },
      ],
    },
    {
      id: 'reshape',
      name: 'Reshape',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 580, y: 0 },
      rows: [
        {
          title: 'Code',
          value:
            'const lead = <enrich.result>; return { company: lead.company, domain: lead.domain };',
        },
      ],
    },
    {
      id: 'score',
      name: 'Score lead',
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
      position: { x: 870, y: 0 },
      rows: [
        { title: 'Messages', value: 'Score <reshape.result> from 0 to 100.' },
        {
          title: 'Response Format',
          value:
            '{"name":"lead_score","schema":{"type":"object","properties":{"score":{"type":"number","minimum":0,"maximum":100}},"required":["score"],"additionalProperties":false}}',
        },
        { title: 'Model', value: 'claude-sonnet-5-5' },
      ],
      tools: [
        { type: 'exa', name: 'Search', bgColor: '#1F40ED' },
        { type: 'gmail', name: 'Send Email', bgColor: '#E0E0E0' },
        { type: 'hubspot', name: 'CRM', bgColor: '#FF7A59' },
        { type: 'workflow_input', name: 'Deep Enrich', bgColor: '#6366F1' },
      ],
    },
    {
      id: 'log',
      name: 'Log',
      type: 'google_sheets',
      typeLabel: 'Google Sheets',
      isIntegration: true,
      sentence: ['Append'],
      bgColor: '#FFFFFF',
      position: { x: 1200, y: 0 },
      rows: [{ title: 'Operation', value: 'Append' }],
    },
  ],
  edges: [
    { id: 'start-enrich', source: 'start', target: 'enrich' },
    { id: 'enrich-reshape', source: 'enrich', target: 'reshape' },
    { id: 'reshape-score', source: 'reshape', target: 'score' },
    { id: 'score-log', source: 'score', target: 'log' },
  ],
}

/**
 * The "Blocks run as soon as they can" diagram on the how-it-runs page: two
 * agents that each depend only on Start, so they run concurrently.
 */
export const CONCURRENCY_WORKFLOW: PreviewWorkflow = {
  id: 'concurrency',
  name: 'Run in parallel',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 80 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Ticket' }],
    },
    {
      id: 'support',
      name: 'Customer Support',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
      bgColor: '#33C482',
      position: { x: 360, y: 0 },
      rows: [{ title: 'Model', value: 'claude-sonnet-5-5' }],
    },
    {
      id: 'research',
      name: 'Deep Researcher',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
      bgColor: '#33C482',
      position: { x: 360, y: 150 },
      rows: [{ title: 'Model', value: 'claude-sonnet-5-5' }],
    },
  ],
  edges: [
    { id: 'start-support', source: 'start', target: 'support' },
    { id: 'start-research', source: 'start', target: 'research' },
  ],
}

/**
 * The "A block waits for all its inputs" diagram: a Function that runs only
 * after both agents finish, reading both outputs.
 */
export const COMBINATION_WORKFLOW: PreviewWorkflow = {
  id: 'combination',
  name: 'Wait for all inputs',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 80 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Ticket' }],
    },
    {
      id: 'support',
      name: 'Customer Support',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
      bgColor: '#33C482',
      position: { x: 360, y: 0 },
      rows: [{ title: 'Model', value: 'claude-sonnet-5-5' }],
    },
    {
      id: 'research',
      name: 'Deep Researcher',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
      bgColor: '#33C482',
      position: { x: 360, y: 150 },
      rows: [{ title: 'Model', value: 'claude-sonnet-5-5' }],
    },
    {
      id: 'combine',
      name: 'Combine',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 720, y: 75 },
      rows: [
        { title: 'Language', value: 'JavaScript' },
        {
          title: 'Code',
          value:
            'return { support: <customersupport.content>, research: <deepresearcher.content> };',
        },
      ],
    },
  ],
  edges: [
    { id: 'start-support', source: 'start', target: 'support' },
    { id: 'start-research', source: 'start', target: 'research' },
    { id: 'support-combine', source: 'support', target: 'combine' },
    { id: 'research-combine', source: 'research', target: 'combine' },
  ],
}

/**
 * The "Branches follow one path" diagram: a Condition splits on an explicit
 * rule, and on one branch a Router lets a model choose among paths.
 */
export const ROUTING_WORKFLOW: PreviewWorkflow = {
  id: 'routing',
  name: 'Branch by condition and router',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 140 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'message (string), type (string)' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      typeLabel: 'Condition',
      bgColor: '#FF752F',
      position: { x: 340, y: 140 },
      rows: [],
      branches: [
        { id: 'condition-if', label: 'If', value: "<start.type> === 'lead'" },
        { id: 'condition-else', label: 'else' },
      ],
    },
    {
      id: 'router',
      name: 'Router',
      type: 'router',
      typeLabel: 'Router',
      bgColor: '#28C43F',
      position: { x: 740, y: 0 },
      rows: [],
      branches: [
        { id: 'router-sales', label: 'Sales' },
        { id: 'router-support', label: 'Support' },
      ],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
      bgColor: '#33C482',
      position: { x: 740, y: 280 },
      rows: [{ title: 'Model', value: 'claude-sonnet-5-5' }],
    },
    {
      id: 'sales',
      name: 'Sales',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
      bgColor: '#33C482',
      position: { x: 1120, y: -60 },
      rows: [{ title: 'Model', value: 'claude-sonnet-5-5' }],
    },
    {
      id: 'support',
      name: 'Support',
      type: 'agent',
      typeLabel: 'Agent',
      sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
      bgColor: '#33C482',
      position: { x: 1120, y: 90 },
      rows: [{ title: 'Model', value: 'claude-sonnet-5-5' }],
    },
  ],
  edges: [
    { id: 'start-condition', source: 'start', target: 'condition' },
    { id: 'condition-router', source: 'condition', target: 'router', sourceHandle: 'condition-if' },
    { id: 'condition-reply', source: 'condition', target: 'reply', sourceHandle: 'condition-else' },
    { id: 'router-sales', source: 'router', target: 'sales', sourceHandle: 'router-sales' },
    { id: 'router-support', source: 'router', target: 'support', sourceHandle: 'router-support' },
  ],
}

/**
 * The "When a block fails" diagram: a Function fails and the run leaves through
 * its red error port to a handler, while the normal-path block never runs.
 */
export const ERROR_PATH_WORKFLOW: PreviewWorkflow = {
  id: 'error-path',
  name: 'Handle a failure',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      typeLabel: 'Start',
      sentence: ['Start the workflow', 'with', { subBlockId: 'Input' }],
      bgColor: '#2FB3FF',
      position: { x: 0, y: 80 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Order' }],
    },
    {
      id: 'throwError',
      name: 'throwError',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 340, y: 80 },
      rows: [
        { title: 'Language', value: 'JavaScript' },
        { title: 'Code', value: 'throw new Error("failed")' },
      ],
    },
    {
      id: 'handleSuccess',
      name: 'handleSuccess',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 720, y: 0 },
      rows: [{ title: 'Code', value: 'return "ok";' }],
    },
    {
      id: 'handleError',
      name: 'handleError',
      type: 'function',
      typeLabel: 'Function',
      sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
      bgColor: '#FF402F',
      position: { x: 720, y: 170 },
      rows: [{ title: 'Code', value: 'return "recovered";' }],
    },
  ],
  edges: [
    { id: 'start-throw', source: 'start', target: 'throwError' },
    { id: 'throw-success', source: 'throwError', target: 'handleSuccess' },
    { id: 'throw-error', source: 'throwError', target: 'handleError', sourceHandle: 'error' },
  ],
}
