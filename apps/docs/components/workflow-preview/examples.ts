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
