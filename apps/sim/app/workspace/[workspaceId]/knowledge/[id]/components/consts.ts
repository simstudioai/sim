export const SYNC_INTERVALS = [
  { label: 'Live', value: 5, requiresMax: true },
  { label: 'Every hour', value: 60, requiresMax: false },
  { label: 'Every 6 hours', value: 360, requiresMax: false },
  { label: 'Daily', value: 1440, requiresMax: false },
  { label: 'Weekly', value: 10080, requiresMax: false },
  { label: 'Manual only', value: 0, requiresMax: false },
] as const
