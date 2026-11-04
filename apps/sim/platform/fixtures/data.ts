import 'server-only'
import type { PreviewData, Scenario } from '@/platform/fixtures'

const panelLabels = {
  rangeLabel: 'All requests',
  tabTitle: 'New tab',
  address: 'Search or enter a URL',
  launcherTitle: 'Terminal',
  launcherHint: 'Run commands in this session',
  alternateTitle: 'Workspaces',
  alternateHint: 'Open a workspace',
}
const chartLabels = {
  trendTitle: 'Workflow runs',
  barTitle: 'Runs by day',
  donutTitle: 'Runs by workflow',
  axisMax: '18',
  axisMiddle: '9',
  axisMin: '0',
  startDate: 'Jan 1',
  midDate: 'Jan 15',
  endDate: 'Jan 31',
  day1: 'Mon',
  day2: 'Tue',
  day3: 'Wed',
  day4: 'Thu',
  day5: 'Fri',
  day6: 'Sat',
  day7: 'Sun',
  completedSeries: 'Succeeded',
  retrySeries: 'Retried',
  total: '100',
  totalLabel: 'Total runs',
  category1: 'Review',
  category2: 'Triage',
  category3: 'Sync',
  category4: 'Digest',
  share1: '38%',
  share2: '31%',
  share3: '22%',
  share4: '9%',
  metric1: 'Runs',
  metricValue1: '100',
  metric2: 'Success rate',
  metricValue2: '98%',
  metric3: 'Agents',
  metricValue3: '4',
  metric4: 'Median duration',
  metricValue4: '8s',
}
const artwork = (viewBox: string, drawing: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${drawing}</svg>`)}`
const avatarSrc = artwork(
  '0 0 40 40',
  '<circle cx="20" cy="16" r="8"/><path d="M4 40a16 16 0 0 1 32 0Z"/>'
)
const samples = {
  avatarSrc,
  media: {
    src: artwork('0 0 160 100', '<path d="M0 88L42 41L68 69L106 22L160 88V100H0Z"/>'),
    label: 'Attachment preview',
  },
  ranges: ['Last 7 days', 'Last 30 days', 'All requests'],
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
        requests: 1090,
        resolved: '98.4%',
        duration: '6s',
        cost: '$21.18',
      },
    },
    {
      id: 'review',
      values: {
        agent: 'Review assistant',
        requests: 1290,
        resolved: '98.7%',
        duration: '9s',
        cost: '$25.32',
      },
    },
  ],
}

export const scenarios: Record<Scenario, PreviewData> = {
  empty: {
    dashboard: { destinations: [], metrics: [], rows: [] },
    samples: { ranges: [], actions: [], recipients: [], notes: '' },
    charts: { trend: [], bars: [], distribution: [] },
    specimen: {},
    organization: { name: 'Sample studio', members: [], workspaces: [] },
  },
  full: {
    dashboard,
    samples,
    charts: {
      trend: [6, 9, 8, 12, 11, 15],
      bars: [
        [4, 2],
        [8, 2],
        [6, 2],
        [10, 4],
        [8, 3],
        [12, 4],
        [7, 1],
      ],
      distribution: [38, 31, 22, 9],
    },
    specimen: {
      ...chartLabels,
      ...panelLabels,
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
      workspaces: [
        {
          name: 'Operations',
          chats: ['Weekly review', 'Triage incoming requests', 'Prepare release notes'],
        },
        { name: 'Product', chats: ['Plan the next release'] },
      ],
    },
  },
  stress: {
    dashboard: {
      ...dashboard,
      rows: Array.from({ length: 25 }, (_, index) => ({
        id: `request-${index}`,
        values: {
          ...dashboard.rows[index % dashboard.rows.length].values,
          agent: `International operations and research request ${index + 1}`,
        },
      })),
    },
    samples: {
      ...samples,
      notes:
        'Review all routing conditions and notifications before the next international operations handoff.',
      recipients: [
        ...samples.recipients,
        { address: 'pending-address', invalid: true },
        { address: 'remy@example.test' },
      ],
    },
    charts: {
      trend: [4, 10, 7, 15, 3, 14, 18, 8, 17],
      bars: [
        [6, 1],
        [9, 8],
        [3, 2],
        [8, 6],
        [10, 6],
        [11, 4],
        [5, 3],
      ],
      distribution: [49, 34, 16, 1],
    },
    specimen: {
      ...chartLabels,
      ...panelLabels,
      title: 'Review all incoming requests for international operations and research',
      column: 'Created',
      status: 'In progress',
      duration: '2m 18s',
      share1: '49%',
      share2: '34%',
      share3: '16%',
      share4: '1%',
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
      workspaces: Array.from({ length: 12 }, (_, index) => ({
        name: `Workspace ${index + 1} — International operations and research`,
        chats: Array.from(
          { length: 8 },
          (_, i) => `Review request ${i + 1} for international operations and research`
        ),
      })),
    },
  },
}
