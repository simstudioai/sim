/**
 * A hand-authored block, described as what the builder canvas displays.
 *
 * - `rows` are the visible sub-block rows; use `'-'` for an empty/unset field (the canvas
 *   shows a dash), or a representative value where the field has a default.
 * - `branches` render one output handle per entry (Condition's if/else-if/else, Router's
 *   routes); when set, also set `hideSourceHandle: true` so the single output is replaced.
 * - `showError: true` adds the bottom `Error` row + red handle (action blocks, not triggers).
 * - `hideTargetHandle: true` for triggers (entry points — no input).
 * - `bgColor` is the resolved hex; the Agent uses Sim green `#33C482` (`var(--brand)`).
 */
export interface BlockDisplaySpec {
  name: string
  /** Block type — drives the header icon (see `BLOCK_ICONS`). */
  type: string
  /** Resolved brand color (hex). */
  bgColor: string
  rows: Array<{ title: string; value: string }>
  branches?: string[]
  showError?: boolean
  hideTargetHandle?: boolean
  hideSourceHandle?: boolean
}

/**
 * Display specs for the block reference previews — one per block, edited to match exactly
 * what the builder canvas shows. Source of truth for the `<BlockPreview>` heroes.
 */

export const BLOCK_DISPLAY_SPECS: Record<string, BlockDisplaySpec> = {
  agent: {
    name: 'Agent',
    type: 'agent',
    bgColor: '#33C482',
    showError: true,
    rows: [
      { title: 'Messages', value: '-' },
      { title: 'Model', value: 'claude-sonnet-4-6' },
      { title: 'Files', value: '-' },
      { title: 'Tools', value: '-' },
      { title: 'Skills', value: '-' },
      { title: 'Memory', value: 'None' },
      { title: 'Response Format', value: '-' },
    ],
  },
  api: {
    name: 'API',
    type: 'api',
    bgColor: '#2F55FF',
    showError: true,
    rows: [
      { title: 'URL', value: '-' },
      { title: 'Method', value: 'GET' },
      { title: 'Query Params', value: '-' },
      { title: 'Headers', value: '-' },
      { title: 'Body', value: '-' },
    ],
  },
  condition: {
    name: 'Condition',
    type: 'condition',
    bgColor: '#FF752F',
    showError: true,
    hideSourceHandle: true,
    rows: [],
    branches: ['if', 'else if', 'else'],
  },
  credential: {
    name: 'Credential',
    type: 'credential',
    bgColor: '#6366F1',
    showError: true,
    rows: [
      { title: 'Operation', value: 'Select Credential' },
      { title: 'Credential', value: '-' },
    ],
  },
  evaluator: {
    name: 'Evaluator',
    type: 'evaluator',
    bgColor: '#4D5FFF',
    showError: true,
    rows: [
      { title: 'Evaluation Metrics', value: '-' },
      { title: 'Content', value: '-' },
      { title: 'Model', value: 'claude-sonnet-4-6' },
    ],
  },
  function: {
    name: 'Function',
    type: 'function',
    bgColor: '#FF402F',
    showError: true,
    rows: [
      { title: 'Language', value: 'JavaScript' },
      { title: 'Code', value: '-' },
    ],
  },
  guardrails: {
    name: 'Guardrails',
    type: 'guardrails',
    bgColor: '#3D642D',
    showError: true,
    rows: [
      { title: 'Content to Validate', value: '-' },
      { title: 'Validation Type', value: 'Valid JSON' },
    ],
  },
  response: {
    name: 'Response',
    type: 'response',
    bgColor: '#2F55FF',
    showError: true,
    hideSourceHandle: true,
    rows: [
      { title: 'Response Data Mode', value: 'Builder' },
      { title: 'Response Structure', value: '-' },
      { title: 'Status Code', value: '-' },
      { title: 'Response Headers', value: '-' },
    ],
  },
  router: {
    name: 'Router',
    type: 'router',
    bgColor: '#28C43F',
    showError: true,
    hideSourceHandle: true,
    rows: [{ title: 'Context', value: '-' }],
    branches: ['route 1'],
  },
  variables: {
    name: 'Variables',
    type: 'variables',
    bgColor: '#8B5CF6',
    showError: true,
    rows: [{ title: 'Variable Assignments', value: '-' }],
  },
  wait: {
    name: 'Wait',
    type: 'wait',
    bgColor: '#F59E0B',
    showError: true,
    rows: [
      { title: 'Wait Amount', value: '-' },
      { title: 'Unit', value: 'Seconds' },
    ],
  },
  webhook: {
    name: 'Webhook',
    type: 'webhook',
    bgColor: '#10B981',
    showError: true,
    rows: [
      { title: 'Webhook URL', value: '-' },
      { title: 'Payload', value: '-' },
      { title: 'Signing Secret', value: '-' },
      { title: 'Additional Headers', value: '-' },
    ],
  },
  workflow: {
    name: 'Workflow',
    type: 'workflow',
    bgColor: '#6366F1',
    showError: true,
    rows: [
      { title: 'Select Workflow', value: '-' },
      { title: 'Input Variable', value: '-' },
    ],
  },
  human_in_the_loop: {
    name: 'Human in the Loop',
    type: 'human_in_the_loop',
    bgColor: '#10B981',
    showError: true,
    rows: [
      { title: 'Display Data', value: '-' },
      { title: 'Notification', value: '-' },
      { title: 'Resume Form', value: '-' },
    ],
  },
  schedule: {
    name: 'Schedule',
    type: 'schedule',
    bgColor: '#6366F1',
    hideTargetHandle: true,
    rows: [
      { title: 'Run frequency', value: 'Every X Minutes' },
      { title: 'Interval (minutes)', value: '-' },
    ],
  },
  rss: {
    name: 'RSS Feed',
    type: 'rss',
    bgColor: '#F97316',
    hideTargetHandle: true,
    rows: [{ title: 'Feed URL', value: '-' }],
  },
  webhook_trigger: {
    name: 'Webhook',
    type: 'webhook',
    bgColor: '#10B981',
    hideTargetHandle: true,
    rows: [
      { title: 'Webhook URL', value: '-' },
      { title: 'Require Authentication', value: '-' },
      { title: 'Input Format', value: '-' },
    ],
  },
  table: {
    name: 'Table',
    type: 'table',
    bgColor: '#10B981',
    hideTargetHandle: true,
    rows: [
      { title: 'Table', value: '-' },
      { title: 'Event type', value: 'Row updated' },
      { title: 'Watch columns', value: '-' },
    ],
  },
}
