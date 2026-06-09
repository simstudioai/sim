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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Customer message' }],
    },
    {
      id: 'agent',
      name: 'Agent',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 340, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Model', value: 'claude-sonnet-4-6' },
        { title: 'Messages', value: 'Classify <start.input>' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Customer message' }],
    },
    {
      id: 'classify',
      name: 'Classify',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 330, y: 0 },
      rows: [
        { title: 'Model', value: 'claude-sonnet-4-6' },
        { title: 'Messages', value: 'Classify <start.input>' },
      ],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 660, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Model', value: 'claude-sonnet-4-6' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Customer question' }],
    },
    {
      id: 'knowledge',
      name: 'Knowledge',
      type: 'knowledge',
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
      bgColor: '#33C482',
      position: { x: 660, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Model', value: 'claude-sonnet-4-6' },
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
      type: 'table',
      bgColor: '#10B981',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [
        { title: 'Operation', value: 'Query Rows' },
        { title: 'Filter', value: 'status = unprocessed' },
      ],
    },
    {
      id: 'classify',
      name: 'Classify',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 330, y: 0 },
      rows: [
        { title: 'Model', value: 'claude-sonnet-4-6' },
        { title: 'Messages', value: 'Classify each lead' },
      ],
    },
    {
      id: 'table2',
      name: 'Table 2',
      type: 'table',
      bgColor: '#10B981',
      position: { x: 660, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Operation', value: 'Update Rows' },
        { title: 'Set', value: 'status = qualified' },
      ],
    },
  ],
  edges: [
    { id: 'table1-classify', source: 'table1', target: 'classify' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'City' }],
    },
    {
      id: 'api',
      name: 'API',
      type: 'api',
      bgColor: '#2F55FF',
      position: { x: 330, y: 0 },
      rows: [
        { title: 'Method', value: 'GET' },
        { title: 'URL', value: 'api.weather.com/<start.input>' },
      ],
    },
    {
      id: 'agent',
      name: 'Agent',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 660, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Model', value: 'claude-sonnet-4-6' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 60 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Ticket' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 330, y: 60 },
      rows: [{ title: 'If', value: "<start.priority> === 'high'" }],
    },
    {
      id: 'escalate',
      name: 'Escalate',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Escalate this ticket' }],
    },
    {
      id: 'reply',
      name: 'Reply',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 130 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Draft a standard reply' }],
    },
  ],
  edges: [
    { id: 'start-condition', source: 'start', target: 'condition' },
    { id: 'condition-escalate', source: 'condition', target: 'escalate' },
    { id: 'condition-reply', source: 'condition', target: 'reply' },
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
      bgColor: '#33C482',
      position: { x: 0, y: 60 },
      hideTargetHandle: true,
      rows: [{ title: 'Messages', value: 'Score toxicity of <start.input>' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 330, y: 60 },
      rows: [{ title: 'If', value: '<moderate.toxicity> > 0.7' }],
    },
    {
      id: 'block',
      name: 'Block',
      type: 'function',
      bgColor: '#FF402F',
      position: { x: 700, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Code', value: "throw 'blocked'" }],
    },
    {
      id: 'publish',
      name: 'Publish',
      type: 'api',
      bgColor: '#2F55FF',
      position: { x: 700, y: 130 },
      hideSourceHandle: true,
      rows: [{ title: 'Method', value: 'POST' }],
    },
  ],
  edges: [
    { id: 'moderate-condition', source: 'moderate', target: 'condition' },
    { id: 'condition-block', source: 'condition', target: 'block' },
    { id: 'condition-publish', source: 'condition', target: 'publish' },
  ],
}

/** Condition example: branch onboarding on the account tier. */
export const CONDITION_ONBOARD_WORKFLOW: PreviewWorkflow = {
  id: 'condition-onboard',
  name: 'Branch onboarding',
  blocks: [
    {
      id: 'plan',
      name: 'Plan',
      type: 'function',
      bgColor: '#FF402F',
      position: { x: 0, y: 60 },
      hideTargetHandle: true,
      rows: [{ title: 'Code', value: 'return <start.account>' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 330, y: 60 },
      rows: [{ title: 'If', value: "<plan.result.tier> === 'enterprise'" }],
    },
    {
      id: 'guided',
      name: 'Guided setup',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Walk through SSO and SCIM' }],
    },
    {
      id: 'quickstart',
      name: 'Quick start',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 130 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Send the 2-minute setup' }],
    },
  ],
  edges: [
    { id: 'plan-condition', source: 'plan', target: 'condition' },
    { id: 'condition-guided', source: 'condition', target: 'guided' },
    { id: 'condition-quickstart', source: 'condition', target: 'quickstart' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'User ID' }],
    },
    {
      id: 'api',
      name: 'API',
      type: 'api',
      bgColor: '#2F55FF',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Method', value: 'GET' },
        { title: 'URL', value: 'api.example.com/users/<start.input>' },
      ],
    },
    {
      id: 'extract',
      name: 'Extract',
      type: 'function',
      bgColor: '#FF402F',
      position: { x: 640, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Language', value: 'JavaScript' },
        { title: 'Code', value: 'return <api.data>.profile' },
      ],
    },
  ],
  edges: [
    { id: 'start-api', source: 'start', target: 'api' },
    { id: 'api-extract', source: 'api', target: 'extract' },
  ],
}

/** Function example: validate and clean input before writing it. */
export const FUNCTION_VALIDATE_WORKFLOW: PreviewWorkflow = {
  id: 'function-validate',
  name: 'Validate before write',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Form' }],
    },
    {
      id: 'clean',
      name: 'Clean',
      type: 'function',
      bgColor: '#FF402F',
      position: { x: 320, y: 0 },
      rows: [
        { title: 'Language', value: 'JavaScript' },
        { title: 'Code', value: 'return sanitize(<start.input>)' },
      ],
    },
    {
      id: 'save',
      name: 'Save',
      type: 'api',
      bgColor: '#2F55FF',
      position: { x: 640, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Method', value: 'POST' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 95 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Ticket' }],
    },
    {
      id: 'router',
      name: 'Router',
      type: 'router',
      bgColor: '#28C43F',
      position: { x: 320, y: 95 },
      rows: [
        { title: 'Context', value: '<start.input>' },
        { title: 'Model', value: 'claude-sonnet-4-6' },
      ],
    },
    {
      id: 'sales',
      name: 'Sales',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Answer the pricing question' }],
    },
    {
      id: 'support',
      name: 'Support',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 95 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Help with the issue' }],
    },
    {
      id: 'billing',
      name: 'Billing',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 190 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Resolve the billing question' }],
    },
  ],
  edges: [
    { id: 'start-router', source: 'start', target: 'router' },
    { id: 'router-sales', source: 'router', target: 'sales' },
    { id: 'router-support', source: 'router', target: 'support' },
    { id: 'router-billing', source: 'router', target: 'billing' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Question' }],
    },
    {
      id: 'agent',
      name: 'Agent',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 320, y: 0 },
      rows: [{ title: 'Messages', value: 'Answer <start.input>' }],
    },
    {
      id: 'response',
      name: 'Response',
      type: 'response',
      bgColor: '#2F55FF',
      position: { x: 640, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Data', value: '{ "answer": <agent.content> }' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 50 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Feedback' }],
    },
    {
      id: 'router',
      name: 'Router',
      type: 'router',
      bgColor: '#28C43F',
      position: { x: 320, y: 50 },
      rows: [{ title: 'Context', value: '<start.input>' }],
    },
    {
      id: 'product',
      name: 'Product',
      type: 'workflow',
      bgColor: '#6366F1',
      position: { x: 700, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Workflow', value: 'product-intake' }],
    },
    {
      id: 'bug',
      name: 'Bug report',
      type: 'workflow',
      bgColor: '#6366F1',
      position: { x: 700, y: 110 },
      hideSourceHandle: true,
      rows: [{ title: 'Workflow', value: 'bug-triage' }],
    },
  ],
  edges: [
    { id: 'start-router', source: 'start', target: 'router' },
    { id: 'router-product', source: 'router', target: 'product' },
    { id: 'router-bug', source: 'router', target: 'bug' },
  ],
}

/** Router example: qualify a lead into sales or self-serve. */
export const ROUTER_LEAD_WORKFLOW: PreviewWorkflow = {
  id: 'router-lead',
  name: 'Qualify a lead',
  blocks: [
    {
      id: 'start',
      name: 'Start',
      type: 'start_trigger',
      bgColor: '#2FB3FF',
      position: { x: 0, y: 50 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Lead' }],
    },
    {
      id: 'router',
      name: 'Router',
      type: 'router',
      bgColor: '#28C43F',
      position: { x: 320, y: 50 },
      rows: [{ title: 'Context', value: '<start.input>' }],
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 700, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Book a sales call' }],
    },
    {
      id: 'selfserve',
      name: 'Self-serve',
      type: 'workflow',
      bgColor: '#6366F1',
      position: { x: 700, y: 110 },
      hideSourceHandle: true,
      rows: [{ title: 'Workflow', value: 'onboarding' }],
    },
  ],
  edges: [
    { id: 'start-router', source: 'start', target: 'router' },
    { id: 'router-enterprise', source: 'router', target: 'enterprise' },
    { id: 'router-selfserve', source: 'router', target: 'selfserve' },
  ],
}

/** Response example: acknowledge a webhook after processing it. */
export const RESPONSE_WEBHOOK_WORKFLOW: PreviewWorkflow = {
  id: 'response-webhook',
  name: 'Acknowledge a webhook',
  blocks: [
    {
      id: 'webhook',
      name: 'Webhook',
      type: 'webhook',
      bgColor: '#10B981',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Format', value: 'JSON' }],
    },
    {
      id: 'process',
      name: 'Process',
      type: 'function',
      bgColor: '#FF402F',
      position: { x: 320, y: 0 },
      rows: [{ title: 'Code', value: 'save(<webhook.body>)' }],
    },
    {
      id: 'ack',
      name: 'Response',
      type: 'response',
      bgColor: '#2F55FF',
      position: { x: 640, y: 0 },
      hideSourceHandle: true,
      rows: [
        { title: 'Data', value: '{ "received": true }' },
        { title: 'Status', value: '200' },
      ],
    },
  ],
  edges: [
    { id: 'webhook-process', source: 'webhook', target: 'process' },
    { id: 'process-ack', source: 'process', target: 'ack' },
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
      bgColor: '#2FB3FF',
      position: { x: 0, y: 60 },
      hideTargetHandle: true,
      rows: [{ title: 'Input', value: 'Request' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 320, y: 60 },
      rows: [{ title: 'If', value: '<start.valid>' }],
    },
    {
      id: 'ok',
      name: 'Response',
      type: 'response',
      bgColor: '#2F55FF',
      position: { x: 700, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Status', value: '200' }],
    },
    {
      id: 'bad',
      name: 'Response',
      type: 'response',
      bgColor: '#2F55FF',
      position: { x: 700, y: 130 },
      hideSourceHandle: true,
      rows: [{ title: 'Status', value: '400' }],
    },
  ],
  edges: [
    { id: 'start-condition', source: 'start', target: 'condition' },
    { id: 'condition-ok', source: 'condition', target: 'ok' },
    { id: 'condition-bad', source: 'condition', target: 'bad' },
  ],
}

/** Variables example: count retries across attempts. */
export const VARIABLES_RETRY_WORKFLOW: PreviewWorkflow = {
  id: 'variables-retry',
  name: 'Count retries',
  blocks: [
    {
      id: 'api',
      name: 'API',
      type: 'api',
      bgColor: '#2F55FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'Method', value: 'GET' }],
    },
    {
      id: 'vars',
      name: 'Variables',
      type: 'variables',
      bgColor: '#8B5CF6',
      position: { x: 320, y: 0 },
      rows: [{ title: 'Set', value: 'retryCount + 1' }],
    },
    {
      id: 'condition',
      name: 'Condition',
      type: 'condition',
      bgColor: '#FF752F',
      position: { x: 640, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'If', value: '<variable.retryCount> < 3' }],
    },
  ],
  edges: [
    { id: 'api-vars', source: 'api', target: 'vars' },
    { id: 'vars-condition', source: 'vars', target: 'condition' },
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
      bgColor: '#2F55FF',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      rows: [{ title: 'URL', value: 'api.example.com/profile' }],
    },
    {
      id: 'vars',
      name: 'Variables',
      type: 'variables',
      bgColor: '#8B5CF6',
      position: { x: 320, y: 0 },
      rows: [{ title: 'Set', value: 'userId, userTier' }],
    },
    {
      id: 'agent',
      name: 'Agent',
      type: 'agent',
      bgColor: '#33C482',
      position: { x: 640, y: 0 },
      hideSourceHandle: true,
      rows: [{ title: 'Messages', value: 'Personalize for <variable.userTier>' }],
    },
  ],
  edges: [
    { id: 'api-vars', source: 'api', target: 'vars' },
    { id: 'vars-agent', source: 'vars', target: 'agent' },
  ],
}
