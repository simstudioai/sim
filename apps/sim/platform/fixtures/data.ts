import 'server-only'
import type { PreviewData, Scenario } from '@/platform/fixtures'

const recordLabels = {
  metadataLabel: 'Version',
  metadataValue: 'v3',
  activity: 'Working for 12s',
  stepName: 'Review request',
  message: 'Review the incoming workspace requests.',
  time: '09:42',
  subject: 'Release notes',
  excerpt: 'The weekly review is ready.',
  payload: '{"task":"review","attempt":1}',
}
const panelLabels = {
  rangeLabel: 'All requests',
  tabTitle: 'New tab',
  address: 'Search or enter a URL',
  launcherTitle: 'Terminal',
  launcherHint: 'Run commands in this session',
  alternateTitle: 'Workspaces',
  alternateHint: 'Open a workspace',
}
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function trend(values: number[]) {
  return values.map((value, index) => ({ label: `Jan ${index + 1}`, value }))
}
function bars(values: [number, number][]) {
  return values.map((pair, index) => ({
    label: values.length === 7 ? weekdays[index] : `W${index + 1}`,
    values: pair,
  }))
}
function distribution(values: number[]) {
  const labels = ['Review', 'Triage', 'Sync', 'Digest', 'Dispatch', 'Escalate']
  return values.map((value, i) => ({ label: labels[i], value }))
}
const artwork = (viewBox: string, drawing: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${drawing}</svg>`)}`
const avatarSrc = artwork(
  '0 0 40 40',
  '<circle cx="20" cy="16" r="8"/><path d="M4 40a16 16 0 0 1 32 0Z"/>'
)
const samples: PreviewData['samples'] = {
  labels: ['Weekly review', 'Operations', 'Incoming requests', 'Release notes', 'Review assistant'],
  captions: [
    'Today',
    'Last updated yesterday',
    'Ready for review',
    '3 requests',
    'Workspace activity',
  ],
  properties: [
    { id: 'status', label: 'Status', kind: 'text', value: 'Needs review' },
    { id: 'created', label: 'Created', kind: 'metadata', value: 'Nov 3, 10:24' },
    { id: 'updated', label: 'Updated', kind: 'metadata', value: '12 minutes ago' },
  ],
  avatarSrc,
  media: {
    src: artwork('0 0 160 100', '<path d="M0 88L42 41L68 69L106 22L160 88V100H0Z"/>'),
    label: 'Attachment preview',
  },
  ranges: ['Last 7 days', 'Last 30 days', 'Last 90 days'],
  actions: ['Open workspace', 'Copy link', 'Rename', 'Move to workspace'],
  recipients: [{ address: 'alex@example.test' }, { address: 'jo@example.test' }],
  notes: 'Review the routing and confirm the expected result.',
}
const dashboard: PreviewData['dashboard'] = {
  destinations: [
    'Dashboard',
    'Issues',
    'Changelog',
    'Workflows',
    'Tables',
    'Files',
    'Knowledge bases',
    'Logs',
    'Settings',
  ],
  metrics: [
    { label: 'Workflow runs', value: '2,380' },
    { label: 'Success rate', value: '98.6%' },
    { label: 'Agents enabled', value: '4' },
    { label: 'Median duration', value: '8s' },
  ],
  rows: [
    {
      id: 'intake',
      values: {
        agent: 'Intake assistant',
        status: '8 running',
        requests: 1090,
        resolved: 0.984,
        duration: 4.2,
        cost: 21.18,
      },
    },
    {
      id: 'review',
      values: {
        agent: 'Review assistant',
        status: '5 running',
        requests: 1290,
        resolved: 0.987,
        duration: 9.8,
        cost: 25.32,
      },
    },
  ],
}

const collections: PreviewData['collections'] = {
  steps: [
    { id: 'triage', description: 'Review the incoming request.' },
    { id: 'confirm', description: 'Confirm the expected output.' },
  ],
  recent: [
    { id: 'weekly-review', label: 'Weekly review', icon: 'I015' },
    { id: 'incoming-requests', label: 'Incoming requests', icon: 'I045' },
  ],
  attachments: [
    {
      id: 'usage-chart',
      kind: 'image',
      name: 'Usage chart.svg',
      description: 'Image',
      preview: samples.media?.src,
    },
    { id: 'review-notes', kind: 'pdf', name: 'Review notes.pdf', description: '3 pages' },
  ],
}
export const scenarios: Record<Scenario, PreviewData> = {
  empty: {
    collections: { recent: [], attachments: [], steps: [] },
    dashboard: { destinations: [], metrics: [], rows: [] },
    samples: {
      labels: [],
      captions: [],
      properties: [],
      ranges: [],
      actions: [],
      recipients: [],
      notes: '',
    },
    charts: { trend: [], bars: [], distribution: [] },
    specimen: {},
    organization: { name: 'Sample studio', members: [], permissionGroups: [], workspaces: [] },
  },
  full: {
    collections,
    dashboard,
    samples,
    charts: {
      maximum: 18000,
      trend: trend([8700, 11300, 9900, 13700, 12300, 16300, 14600]),
      bars: bars([
        [5800, 1800],
        [8100, 2600],
        [6600, 2000],
        [10600, 3400],
        [9100, 2800],
        [12400, 3900],
        [11200, 3600],
      ]),
      distribution: distribution([32201, 26439, 18818, 7281]),
    },
    specimen: {
      ...panelLabels,
      ...recordLabels,
      title: 'Weekly review',
      column: 'Created',
      status: 'Completed',
      duration: '18s',
      workflow: 'Incoming requests',
      trigger: 'Schedule',
      timestamp: 'Today',
      description: 'Reviewed incoming workspace requests.',
      contributor: 'Jo Bell',
      ticket: 'OPS-12',
      units: '28',
      started: '09:42',
    },
    organization: {
      name: 'Sample studio',
      members: ['Alex Rowan', 'Jo Bell', 'Remy Chen'],
      permissionGroups: ['Standard access', 'Customer operations', 'Finance team'],
      workspaces: [
        {
          id: 'operations',
          name: 'Operations',
          chats: ['Weekly review', 'Triage incoming requests', 'Prepare release notes'],
        },
        { id: 'product', name: 'Product', chats: ['Plan the next release'] },
      ],
    },
  },
  stress: {
    collections: {
      steps: Array.from({ length: 27 }, (_, index) => ({
        id: `step-${index}`,
        description: `Review international request ${index + 1}.`,
      })),
      recent: Array.from({ length: 27 }, (_, i) => ({
        id: `recent-${i}`,
        label: `Recent request ${i + 1}`,
        icon: i % 2 === 0 ? 'I015' : 'I045',
      })),
      attachments: Array.from({ length: 27 }, (_, i) =>
        i % 3 === 0
          ? {
              id: `media-${i}`,
              kind: 'image',
              name: `Run chart ${i + 1}.svg`,
              description: 'Image',
              preview: samples.media?.src,
            }
          : {
              id: `document-${i}`,
              kind: i % 2 === 0 ? 'pdf' : 'paste',
              name: `Review note ${i + 1}`,
              description: i % 2 === 0 ? 'PDF' : 'Text',
            }
      ),
    },
    dashboard: {
      ...dashboard,
      rows: Array.from({ length: 25 }, (_, index) => ({
        id: `request-${index}`,
        values: {
          ...dashboard.rows[index % dashboard.rows.length].values,
          ...(index === 0 ? { requests: 0, cost: null } : {}),
          agent: `International operations and research request ${index + 1}`,
        },
      })),
    },
    samples: {
      ...samples,
      properties: [
        { id: 'status', label: 'Status', kind: 'text', value: 'Merged' },
        { id: 'applied', label: 'Applied', kind: 'text', value: 'Nov 3, 10:42 AM' },
        {
          id: 'contributor',
          label: 'Applied by',
          kind: 'person',
          value: 'Jo Bell',
          src: avatarSrc,
        },
        {
          id: 'issue',
          label: 'Issue',
          kind: 'link',
          value: 'OPS-1042',
          href: '?state=stress&recipe=C1336',
        },
        {
          id: 'workspace',
          label: 'Workspace',
          kind: 'text',
          value: 'International operations and research intake review',
        },
      ],
      notes:
        'Review all routing conditions and notifications before the next international operations handoff.',
      recipients: [
        ...samples.recipients,
        { address: 'pending-address', invalid: true },
        { address: 'remy@example.test' },
      ],
    },
    charts: {
      trend: trend([4, 10, 7, 15, 3, 14, 18, 8, 17]),
      bars: bars([
        [6, 1],
        [9, 8],
        [3, 2],
        [8, 6],
        [10, 6],
        [11, 4],
        [5, 3],
        [6, 2],
        [8, 3],
        [10, 4],
        [9, 5],
        [8, 1],
      ]),
      distribution: distribution([49, 34, 16, 1, 8, 6]),
    },
    specimen: {
      ...panelLabels,
      ...recordLabels,
      title: 'Review all incoming requests for international operations and research',
      column: 'Created',
      status: 'In progress',
      duration: '2m 18s',
      workflow: 'International operations and research intake review',
      trigger: 'Manual',
      timestamp: 'Yesterday',
      description: 'A longer example spanning the available reading width for this workspace.',
      contributor: 'Alex Rowan',
      ticket: 'OPS-1042',
      units: '1,240',
      started: '14:15',
    },
    organization: {
      name: 'Sample studio for international operations and research',
      members: ['Alex Rowan', 'Jo Bell', 'Remy Chen', 'Sam Kim', 'Kit Gray', 'Robin Park'],
      permissionGroups: [
        'Standard access',
        'Customer operations',
        'Finance team',
        'Regional operations and service delivery',
      ],
      workspaces: Array.from({ length: 27 }, (_, index) => ({
        id: `workspace-${index}`,
        name: `Workspace ${index + 1} — International operations and research`,
        chats: Array.from(
          { length: 8 },
          (_, i) => `Review request ${i + 1} for international operations and research`
        ),
      })),
    },
  },
}
