/**
 * The workspaces `test-workspace-visual-e2e.ts` photographs, shared with its seed: an Enterprise
 * organization whose owner holds one full workspace and one empty one, plus a free account for the
 * plan picker, which an Enterprise owner never sees. Every id and timestamp is a constant, so two
 * runs of the suite render the same pixels.
 */
export const ORGANIZATION_ID = 'workspace-visual-organization'
export const ORGANIZATION_NAME = 'Harbor Mills'
export const PASSWORD = 'workspace-visual-password-1'

/** Before every real clock, after every seeded row: relative dates read the same on every run. */
export const FROZEN_CLOCK_ISO = '2026-02-01T12:00:00.000Z'
export const SEEDED_AT_ISO = '2026-01-15T09:00:00.000Z'
export const PERIOD_START_ISO = '2026-01-01T00:00:00.000Z'
export const PERIOD_END_ISO = '2099-01-01T00:00:00.000Z'

const person = (key: string, name: string) => ({
  key,
  name,
  userId: `workspace-visual-user-${key}`,
  email: `${key}@workspace-visual.test`,
  sessionToken: `workspace-visual-session-${key}`,
})

export const OWNER = person('owner', 'Olive Owner')
export const TEAMMATE = person('teammate', 'Theo Teammate')
export const FREE = person('free', 'Frank Free')
export const EVERYONE = [OWNER, TEAMMATE, FREE] as const

export const POPULATED_WORKSPACE = { id: 'workspace-visual-populated', name: 'Mill Operations' }
export const EMPTY_WORKSPACE = { id: 'workspace-visual-empty', name: 'Blank Slate' }
export const FREE_WORKSPACE = { id: 'workspace-visual-free', name: 'Personal' }
export const WORKSPACES = [POPULATED_WORKSPACE, EMPTY_WORKSPACE, FREE_WORKSPACE] as const

export const AGENT_WORKFLOW = { id: 'workspace-visual-workflow-agent', name: 'Order triage' }
export const SECOND_WORKFLOW = { id: 'workspace-visual-workflow-second', name: 'Daily digest' }

/** The seeded canvas: a trigger, an agent, a loop holding one block, and a note. */
export const BLOCKS = {
  start: 'workspace-visual-block-start',
  agent: 'workspace-visual-block-agent',
  loop: 'workspace-visual-block-loop',
  loopChild: 'workspace-visual-block-loop-child',
  note: 'workspace-visual-block-note',
} as const

const uuid = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`

export const CHATS = [
  { id: uuid('a'), title: 'Reorder thresholds' },
  { id: uuid('b'), title: 'Supplier scorecard' },
  { id: uuid('c'), title: 'Late shipment summary' },
] as const
export const OPENED_CHAT = CHATS[0]
export const ASSISTANT_REPLY = 'Here is what I found about reorder thresholds.'

export const FILES = [
  { name: 'Quarterly report.pdf', contentType: 'application/pdf', sizeBytes: 482_113 },
  { name: 'Supplier list.csv', contentType: 'text/csv', sizeBytes: 18_204 },
  { name: 'Runbook.md', contentType: 'text/markdown', sizeBytes: 6_021 },
  { name: 'Floor plan.png', contentType: 'image/png', sizeBytes: 1_204_551 },
] as const
export const FIRST_FILE = FILES[0].name
export const DELETED_FILE = 'Old price list.csv'

export const TABLES = ['Orders', 'Suppliers', 'Inventory'] as const
export const FIRST_TABLE = TABLES[0]
export const ORDERS_TABLE_ID = 'workspace-visual-table-0'

export const KNOWLEDGE_BASES = ['Product manuals', 'Safety procedures'] as const
export const FIRST_KNOWLEDGE_BASE = KNOWLEDGE_BASES[0]

export const SKILLS = [
  { name: 'Incident triage', description: 'Sort an incident by severity and owner.' },
  { name: 'Weekly summary', description: 'Condense a week of activity for the team.' },
] as const
export const FIRST_SKILL = SKILLS[0].name

export const DASHBOARD_TITLE = 'Order overview'
export const RELEASES = [
  { title: 'Faster order triage', version: [1, 1, 0], reason: 'Adds a routing step.' },
  { title: 'First release', version: [1, 0, 0], reason: 'First published version.' },
] as const
export const LATEST_RELEASE = RELEASES[0].title

export const LOG_COUNT = 24
export const API_KEYS = ['Warehouse sync', 'Reporting'] as const
export const WORKFLOW_MCP_SERVER_NAME = 'Operations tools'
export const CUSTOM_TOOL_TITLE = 'lookup_order'
export const SECRET_NAMES = ['WAREHOUSE_TOKEN', 'REPORTING_TOKEN'] as const

/** A connect modal exists only for a provider the app holds OAuth credentials for. */
export const OAUTH_INTEGRATION_SLUG = 'gmail'
