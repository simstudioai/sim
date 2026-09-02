/** Under the account picker of a per-member connector, whose account only browses. */
export const BROWSE_WITH_HINT =
  'Only used to pick folders and spaces below. The connector syncs as each member, not as this account.'

export const SYNC_INTERVALS = [
  { label: 'Live', value: 5, requiresMax: true },
  { label: 'Every hour', value: 60, requiresMax: false },
  { label: 'Every 6 hours', value: 360, requiresMax: false },
  { label: 'Daily', value: 1440, requiresMax: false },
  { label: 'Weekly', value: 10080, requiresMax: false },
  { label: 'Manual only', value: 0, requiresMax: false },
] as const
