/** Cell value for the comparison table. */
export type CellValue = string | boolean

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
  /** CTA chip label rendered beneath the price. */
  ctaLabel: string
  /** When true, the CTA chip uses the inverted `primary` (filled) variant to feature this plan. */
  highlighted?: boolean
}

/** Ordered plan columns — indices match `ComparisonRow.values`. */
export const PLAN_COLUMNS: PlanColumn[] = [
  { name: 'Free', staticPrice: '$0', ctaLabel: 'Get started' },
  { name: 'Pro', staticPrice: null, ctaLabel: 'Get started', highlighted: true },
  { name: 'Max', staticPrice: null, ctaLabel: 'Get started' },
  { name: 'Enterprise', staticPrice: 'Custom', ctaLabel: 'Talk to sales' },
]

/** Full comparison dataset. */
export const COMPARISON_SECTIONS: ComparisonSection[] = [
  {
    title: 'Credits & Pricing',
    rows: [
      {
        label: 'Monthly credits',
        values: ['1,000 (trial)', '6,000/mo', '25,000/mo', 'Custom'],
      },
      {
        label: 'Daily refresh',
        values: [false, '+50/day', '+200/day', 'Custom'],
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
        values: ['30', '100', '200', 'Custom'],
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
        values: ['30 days', 'Unlimited', 'Unlimited', 'Custom'],
      },
    ],
  },
  {
    title: 'Features',
    rows: [
      {
        label: 'Sim Mailer (Inbox)',
        values: [false, false, true, 'Custom'],
      },
      {
        label: 'Live Sync',
        values: [false, false, true, 'Custom'],
      },
      {
        label: 'Credential Sets',
        values: [false, false, false, 'Custom'],
      },
      {
        label: 'Organizations / Teams',
        values: [false, false, false, 'Custom'],
      },
      {
        label: 'Access Control',
        values: [false, false, false, 'Custom'],
      },
      {
        label: 'SSO',
        values: [false, false, false, 'Custom'],
      },
      {
        label: 'SOC2 Compliance',
        values: [false, false, false, 'Custom'],
      },
      {
        label: 'Self Hosting',
        values: [false, false, false, 'Custom'],
      },
      {
        label: 'Dedicated Support',
        values: [false, false, false, 'Custom'],
      },
      {
        label: 'Seat Management',
        values: [false, false, false, 'Custom'],
      },
    ],
  },
]
