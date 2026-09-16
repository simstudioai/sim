/** Sample successful runs, shared by the menu and homepage Logs previews. */
const RUN_COUNTS = [
  3, 5, 4, 6, 4, 7, 5, 6, 8, 5, 7, 6, 9, 6, 8, 7, 10, 6, 8, 7, 9, 8, 6, 7,
] as const

export const RUN_BUCKETS = RUN_COUNTS.map((count, hour) => ({ hour, count }))
export const COMPLETED_RUNS = RUN_COUNTS.reduce<number>((total, count) => total + count, 0)
export const SUMMARY_STATS = [
  { label: 'Success rate', value: '100%' },
  { label: 'Median run', value: '21.8s' },
  { label: 'Completed', value: String(COMPLETED_RUNS) },
  { label: 'Cost', value: `$${(COMPLETED_RUNS * 0.11).toFixed(2)}` },
] as const
