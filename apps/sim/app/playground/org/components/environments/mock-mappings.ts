import type {
  EnvironmentColumn,
  MappingRow,
  MappingStatus,
  WorkflowRow,
} from '@/app/playground/org/components/environments/mapping-model'

const PROD = 'mock-prod'
const STAGING = 'mock-staging'
const SANDBOX = 'mock-sandbox'

/** Three environments for a project that exists only as a pack; nothing here is a real workspace. */
export function mockEnvironments(projectName: string): EnvironmentColumn[] {
  return [
    { id: PROD, label: 'Prod', name: `${projectName} Prod`, parentId: null },
    { id: STAGING, label: 'Staging', name: `${projectName} Staging`, parentId: PROD },
    { id: SANDBOX, label: 'Sandbox', name: `${projectName} Sandbox`, parentId: STAGING },
  ]
}

type MockCells = readonly [string, string | null, string | null]
type MockStatuses = readonly [MappingStatus | null, MappingStatus | null]

function row(
  kind: MappingRow['kind'],
  labels: MockCells,
  statuses: MockStatuses = ['mapped', 'mapped']
): MappingRow {
  const [prod, staging, sandbox] = labels
  const cells: MappingRow['cells'] = { [PROD]: { id: prod, label: prod, status: null } }
  if (staging !== null) cells[STAGING] = { id: staging, label: staging, status: statuses[0] }
  if (sandbox !== null) cells[SANDBOX] = { id: sandbox, label: sandbox, status: statuses[1] }
  return { key: `${kind}:${prod}`, kind, label: prod, cells }
}

/** An agent product's resources as they map across its three environments. */
export const MOCK_MAPPING_ROWS: readonly MappingRow[] = [
  row(
    'credential',
    ['Slack (support bot)', 'Slack (staging bot)', 'Slack (sandbox bot)'],
    ['mapped', 'suggested']
  ),
  row('credential', ['Zendesk API', 'Zendesk sandbox', 'Zendesk sandbox']),
  row('credential', ['Gmail (replies)', '', null], ['needs-setup', null]),
  row('env-var', ['OPENAI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_KEY']),
  row('env-var', ['ESCALATION_CHANNEL', 'ESCALATION_CHANNEL', ''], ['mapped', 'needs-setup']),
  row('table', ['Ticket queue', 'Ticket queue', 'Ticket queue']),
  row('table', ['Reply templates', '', ''], ['copy', 'copy']),
  row('knowledge-base', ['Help center articles', 'Help center articles', 'Help center articles']),
  row('knowledge-base', ['Product FAQ', 'Product FAQ', ''], ['mapped', 'copy']),
  row('file-folder', ['Templates', 'Templates', 'Templates']),
  row('file', ['tone-guide.md', 'tone-guide.md', 'tone-guide.md']),
  row('file', ['macros.csv', '', ''], ['copy', 'copy']),
  row('mcp-server', ['Internal tools', 'Internal tools (staging)', ''], ['mapped', 'needs-setup']),
  row('custom-tool', ['Lookup order', 'Lookup order', 'Lookup order']),
  row('custom-block', ['Sentiment score', 'Sentiment score', ''], ['mapped', 'needs-setup']),
  row('skill', ['Refund policy', '', ''], ['copy', 'copy']),
  row('sandbox', ['Repro sandbox', '', null], ['needs-setup', null]),
]

function workflow(
  name: string,
  deployed: readonly [boolean, boolean | null, boolean | null],
  statuses: MockStatuses = ['mapped', 'mapped']
): WorkflowRow {
  const cells: WorkflowRow['cells'] = { [PROD]: { name, status: null, deployed: deployed[0] } }
  if (statuses[0] !== null)
    cells[STAGING] = {
      name: statuses[0] === 'copy' ? null : name,
      status: statuses[0],
      deployed: deployed[1],
    }
  if (statuses[1] !== null)
    cells[SANDBOX] = {
      name: statuses[1] === 'copy' ? null : name,
      status: statuses[1],
      deployed: deployed[2],
    }
  return { key: `workflow:${name}`, label: name, cells }
}

export const MOCK_WORKFLOW_ROWS: readonly WorkflowRow[] = [
  workflow('Triage inbound tickets', [true, true, true]),
  workflow('Draft reply', [true, true, false]),
  workflow('Escalate to on-call', [true, true, null], ['mapped', 'copy']),
  workflow('Weekly quality digest', [true, null, null], ['copy', 'copy']),
]
