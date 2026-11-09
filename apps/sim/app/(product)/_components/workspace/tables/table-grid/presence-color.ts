import { getUserColor, USER_COLORS } from '@/platform/lib/data/tables'

/**
 * The zone's version of the shared identity palette, in the same order, so a collaborator keeps
 * the color the legacy surfaces give them. The legacy values name host-only variables.
 */
const ZONE_USER_COLORS = [
  'var(--status-success)',
  'var(--control-danger)',
  'var(--status-info)',
  'var(--status-warning)',
  'var(--ui-plot-violet-2)',
  'var(--color-orange)',
] as const

/** A collaborator's identity color, consistent across avatars and selections. */
export function presenceColor(userId: string): string {
  const index = (USER_COLORS as readonly string[]).indexOf(getUserColor(userId))
  return ZONE_USER_COLORS[Math.max(0, index) % ZONE_USER_COLORS.length]
}
