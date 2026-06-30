/** A brand icon rendered in a cell instead of a check/em-dash/text. */
export interface CellIcon {
  /** Icon identifier resolved to a component by the table renderer. */
  icon: 'slack'
}

/** Cell value for the comparison table. */
export type CellValue = string | boolean | CellIcon

/** Shared Slack-availability cell. */
const SLACK: CellIcon = { icon: 'slack' }

/** Names of the four plan columns — used as a discriminated union for type-safe plan selection. */
export type PlanName = 'Free' | 'Pro' | 'Max' | 'Enterprise'

/** A single feature row inside a section. */
export interface ComparisonRow {
  /** Row label displayed in the left column. */
  label: string
  /**
   * Values for [Free, Pro, Max, Enterprise].
   * `true` renders a check icon; `false` renders a muted em-dash.
   * Strings render as-is with tabular-nums styling.
   */
  values: [CellValue, CellValue, CellValue, CellValue]
}

/** A labelled group of comparison rows. */
export interface ComparisonSection {
  /** Section header label. */
  title: string
  rows: ComparisonRow[]
}

/** Column metadata for the four plan headers. */
export interface PlanColumn {
  /** Plan name — matches the {@link PlanName} discriminant. */
  name: PlanName
  /**
   * Price display. Pass `null` to signal "use runtime price from state"
   * (handled in the component for Pro and Max).
   */
  staticPrice: string | null
}

/** Ordered plan columns — indices match `ComparisonRow.values`. */
export const PLAN_COLUMNS: PlanColumn[] = [
  { name: 'Free', staticPrice: '$0' },
  { name: 'Pro', staticPrice: null },
  { name: 'Max', staticPrice: null },
  { name: 'Enterprise', staticPrice: 'Custom' },
]

/** Full comparison dataset. */
export const COMPARISON_SECTIONS: ComparisonSection[] = [
  {
    title: 'Credits & pricing',
    rows: [
      {
        label: 'Monthly credits',
        values: ['1,000', '6,000', '25,000', 'Custom'],
      },
      {
        label: 'Daily refresh',
        values: [false, '+50', '+200', 'Custom'],
      },
    ],
  },
  {
    title: 'Workspaces & teams',
    rows: [
      {
        label: 'Workspaces',
        values: ['1', '3', 'Unlimited', 'Unlimited'],
      },
      {
        label: 'Invite teammates',
        values: [false, true, true, true],
      },
    ],
  },
  {
    title: 'Rate limits (runs/min)',
    rows: [
      {
        label: 'Sync executions',
        values: ['50', '150', '300', 'Custom'],
      },
      {
        label: 'Async executions',
        values: ['200', '1,000', '2,500', 'Custom'],
      },
      {
        label: 'API endpoint',
        values: ['0', '100', '200', 'Custom'],
      },
    ],
  },
  {
    title: 'Execution timeouts',
    rows: [
      {
        label: 'Sync timeout',
        values: ['5 min', '50 min', '50 min', 'Custom'],
      },
      {
        label: 'Async timeout',
        values: ['90 min', '90 min', '90 min', 'Custom'],
      },
    ],
  },
  {
    title: 'Storage & data',
    rows: [
      {
        label: 'File storage',
        values: ['5 GB', '50 GB', '500 GB', 'Custom'],
      },
      {
        label: 'Max tables',
        values: ['5', '100', '1,000', 'Custom'],
      },
      {
        label: 'Max rows per table',
        values: ['50,000', '100,000', '500,000', 'Custom'],
      },
      {
        label: 'Log retention',
        values: ['30 days', 'Unlimited', 'Unlimited', 'Unlimited'],
      },
    ],
  },
  {
    title: 'Features',
    rows: [
      {
        label: 'Sim Mailer (Inbox)',
        values: [false, false, true, true],
      },
      {
        label: 'KB Live Sync',
        values: [false, false, true, true],
      },
      {
        label: 'Slack Connect',
        values: [false, false, SLACK, SLACK],
      },
      {
        label: 'Access Control',
        values: [false, false, false, true],
      },
      {
        label: 'SSO',
        values: [false, false, false, true],
      },
      {
        label: 'SOC2 Compliance',
        values: [false, false, false, true],
      },
      {
        label: 'Self Hosting',
        values: [false, false, false, true],
      },
      {
        label: 'Dedicated Support',
        values: [false, false, false, true],
      },
    ],
  },
]
