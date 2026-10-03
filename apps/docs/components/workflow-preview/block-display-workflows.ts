import type { PreviewWorkflow } from '@/components/workflow-preview/workflow-data'

/**
 * Single-block preview workflows for the block reference heroes — one per block,
 * authored to match exactly what the builder canvas shows. Source of truth for
 * `<BlockPreview type="...">`.
 *
 * Each entry is a one-block {@link PreviewWorkflow} rendered through the shared
 * {@link WorkflowBlockView} (via `DocsBlockNode`), so the hero stays pixel-faithful
 * to the canvas. Authoring notes:
 *
 * - `rows` retain configuration values for inspection. `sentence` describes the
 *   canvas card with slots keyed to row titles; `noun` supplies an empty-state label.
 * - `branches` render one output handle per entry (Condition's if/else-if/else,
 *   Router's routes). The View regenerates handle topology, so the label doubles as
 *   the branch id.
 * - `hideTargetHandle: true` for triggers (entry points — no input). The View derives
 *   the default target/source handles and the bottom `Error` row from this gate, so
 *   there is no separate `showError`/`hideSourceHandle` flag.
 * - `bgColor` is the resolved hex; the Agent uses Sim green `#33C482` (`var(--brand)`).
 */
export const BLOCK_DISPLAY_WORKFLOWS: Record<string, PreviewWorkflow> = {
  agent: {
    id: 'agent',
    name: 'Agent',
    blocks: [
      {
        id: 'agent',
        name: 'Agent',
        type: 'agent',
        typeLabel: 'Agent',
        sentence: ['Prompt', { subBlockId: 'Model', noun: 'model' }],
        bgColor: '#33C482',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Messages', value: '-' },
          { title: 'Model', value: 'claude-sonnet-4-6' },
          { title: 'Files', value: '-' },
          { title: 'Tools', value: '-' },
          { title: 'Skills', value: '-' },
          { title: 'Memory', value: 'None' },
          { title: 'Temperature', value: '0.7' },
          { title: 'Response Format', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  api: {
    id: 'api',
    name: 'API',
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
          { title: 'URL', value: '-' },
          { title: 'Method', value: 'GET' },
          { title: 'Query Params', value: '-' },
          { title: 'Headers', value: '-' },
          { title: 'Body', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  condition: {
    id: 'condition',
    name: 'Condition',
    blocks: [
      {
        id: 'condition',
        name: 'Condition',
        type: 'condition',
        typeLabel: 'Condition',
        bgColor: '#FF752F',
        position: { x: 0, y: 0 },
        rows: [],
        branches: [
          { id: 'if', label: 'if' },
          { id: 'else if', label: 'else if' },
          { id: 'else', label: 'else' },
        ],
      },
    ],
    edges: [],
  },
  credential: {
    id: 'credential',
    name: 'Credential',
    blocks: [
      {
        id: 'credential',
        name: 'Credential',
        type: 'credential',
        typeLabel: 'Credential',
        sentence: ['Select an OAuth credential'],
        bgColor: '#6366F1',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Operation', value: 'Select Credential' },
          { title: 'Credential', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  evaluator: {
    id: 'evaluator',
    name: 'Evaluator',
    blocks: [
      {
        id: 'evaluator',
        name: 'Evaluator',
        type: 'evaluator',
        typeLabel: 'Evaluator',
        sentence: [
          'Score',
          { subBlockId: 'Content', noun: 'content' },
          'against',
          { subBlockId: 'Evaluation Metrics', noun: 'metrics' },
        ],
        bgColor: '#4D5FFF',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Evaluation Metrics', value: '-' },
          { title: 'Content', value: '-' },
          { title: 'Model', value: 'claude-sonnet-4-6' },
        ],
      },
    ],
    edges: [],
  },
  function: {
    id: 'function',
    name: 'Function',
    blocks: [
      {
        id: 'function',
        name: 'Function',
        type: 'function',
        typeLabel: 'Function',
        sentence: ['Run', { subBlockId: 'Code', noun: 'code' }],
        bgColor: '#FF402F',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Language', value: 'JavaScript' },
          { title: 'Code', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  guardrails: {
    id: 'guardrails',
    name: 'Guardrails',
    blocks: [
      {
        id: 'guardrails',
        name: 'Guardrails',
        type: 'guardrails',
        typeLabel: 'Guardrails',
        sentence: [
          'Validate content using',
          { subBlockId: 'Validation Type', noun: 'validation type' },
        ],
        bgColor: '#3D642D',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Content to Validate', value: '-' },
          { title: 'Validation Type', value: 'Valid JSON' },
        ],
      },
    ],
    edges: [],
  },
  response: {
    id: 'response',
    name: 'Response',
    blocks: [
      {
        id: 'response',
        name: 'Response',
        type: 'response',
        typeLabel: 'Response',
        sentence: ['Return', { subBlockId: 'Response Structure', noun: 'response' }],
        bgColor: '#2F55FF',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Response Data Mode', value: 'Builder' },
          { title: 'Response Structure', value: '-' },
          { title: 'Status Code', value: '-' },
          { title: 'Response Headers', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  router: {
    id: 'router',
    name: 'Router',
    blocks: [
      {
        id: 'router',
        name: 'Router',
        type: 'router',
        typeLabel: 'Router',
        bgColor: '#28C43F',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Context', value: '-' },
          { title: 'Model', value: 'claude-sonnet-4-6' },
        ],
        branches: [{ id: 'route 1', label: 'route 1' }],
      },
    ],
    edges: [],
  },
  variables: {
    id: 'variables',
    name: 'Variables',
    blocks: [
      {
        id: 'variables',
        name: 'Variables',
        type: 'variables',
        typeLabel: 'Variables',
        sentence: ['Set', { subBlockId: 'Variable Assignments', noun: 'variables' }],
        bgColor: '#8B5CF6',
        position: { x: 0, y: 0 },
        rows: [{ title: 'Variable Assignments', value: '-' }],
      },
    ],
    edges: [],
  },
  wait: {
    id: 'wait',
    name: 'Wait',
    blocks: [
      {
        id: 'wait',
        name: 'Wait',
        type: 'wait',
        typeLabel: 'Wait',
        sentence: [
          'Pause for',
          { subBlockId: 'Wait Amount', noun: 'amount' },
          { subBlockId: 'Unit' },
        ],
        bgColor: '#F59E0B',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Wait Amount', value: '10' },
          { title: 'Unit', value: 'Seconds' },
          { title: 'Async', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  webhook: {
    id: 'webhook',
    name: 'Webhook',
    blocks: [
      {
        id: 'webhook',
        name: 'Webhook',
        type: 'webhook',
        typeLabel: 'Webhook',
        sentence: [
          'Post',
          { subBlockId: 'Payload', noun: 'payload' },
          'to',
          { subBlockId: 'Webhook URL', noun: 'URL' },
        ],
        bgColor: '#10B981',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Webhook URL', value: '-' },
          { title: 'Payload', value: '-' },
          { title: 'Signing Secret', value: '-' },
          { title: 'Additional Headers', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  workflow: {
    id: 'workflow',
    name: 'Workflow',
    blocks: [
      {
        id: 'workflow',
        name: 'Workflow',
        type: 'workflow',
        typeLabel: 'Workflow',
        sentence: ['Run', { subBlockId: 'Select Workflow', noun: 'workflow' }],
        bgColor: '#6366F1',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Select Workflow', value: '-' },
          { title: 'Input Variable', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  human_in_the_loop: {
    id: 'human_in_the_loop',
    name: 'Human in the Loop',
    blocks: [
      {
        id: 'human_in_the_loop',
        name: 'Human in the Loop',
        type: 'human_in_the_loop',
        typeLabel: 'Human',
        sentence: ['Pause execution until a human responds'],
        bgColor: '#10B981',
        position: { x: 0, y: 0 },
        rows: [
          { title: 'Display Data', value: '-' },
          { title: 'Notification (Send URL)', value: '-' },
          { title: 'Resume Form', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  schedule: {
    id: 'schedule',
    name: 'Schedule',
    blocks: [
      {
        id: 'schedule',
        name: 'Schedule',
        type: 'schedule',
        typeLabel: 'Schedule',
        sentence: ['Run daily at', { subBlockId: 'Time', noun: 'time' }],
        bgColor: '#6366F1',
        position: { x: 0, y: 0 },
        hideTargetHandle: true,
        rows: [
          { title: 'Run frequency', value: 'Daily' },
          { title: 'Time', value: '-' },
          { title: 'Timezone', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  rss: {
    id: 'rss',
    name: 'RSS Feed',
    blocks: [
      {
        id: 'rss',
        name: 'RSS Feed',
        type: 'rss',
        typeLabel: 'RSS Feed',
        sentence: ['Run on new RSS feed items'],
        bgColor: '#F97316',
        position: { x: 0, y: 0 },
        hideTargetHandle: true,
        rows: [{ title: 'Feed URL', value: '-' }],
      },
    ],
    edges: [],
  },
  webhook_trigger: {
    id: 'webhook_trigger',
    name: 'Webhook Trigger',
    blocks: [
      {
        id: 'webhook_trigger',
        name: 'Webhook Trigger',
        type: 'webhook',
        triggerMode: true,
        typeLabel: 'Webhook',
        sentence: ['Run on an incoming HTTP request'],
        bgColor: '#10B981',
        position: { x: 0, y: 0 },
        hideTargetHandle: true,
        rows: [
          { title: 'Webhook URL', value: '-' },
          { title: 'Require Authentication', value: 'On' },
          { title: 'Authentication Token', value: '-' },
          { title: 'Secret Header Name (Optional)', value: '-' },
          { title: 'Deduplication Field (Optional)', value: '-' },
          { title: 'Acknowledgement', value: 'Default' },
          { title: 'Verify Test Events', value: '-' },
          { title: 'Input Format', value: '-' },
        ],
      },
    ],
    edges: [],
  },
  table_v2: {
    id: 'table_v2',
    name: 'Table',
    blocks: [
      {
        id: 'table_v2',
        name: 'Table',
        type: 'table_v2',
        typeLabel: 'Table',
        sentence: [
          'Run on',
          { subBlockId: 'Event type', noun: 'event' },
          'in',
          { subBlockId: 'Table', noun: 'table' },
        ],
        bgColor: '#10B981',
        position: { x: 0, y: 0 },
        hideTargetHandle: true,
        rows: [
          { title: 'Table', value: '-' },
          { title: 'Event type', value: 'Row updated' },
          { title: 'Watch columns', value: '-' },
        ],
      },
    ],
    edges: [],
  },
}
