/**
 * The Dashboard tab's seam: the workspace's one dashboard document, legacy's parser, and legacy's
 * time-range state and URL keys, unchanged. Panels read their tables through the same names the
 * markdown embed uses, from `@/platform/lib/data/files/dashboards`.
 */

export {
  dashboardParsers,
  dashboardTabParser,
  dashboardUrlKeys,
  dashboardUrlOptions,
} from '@/components/dashboards/search-params'
export { useDashboardTime } from '@/components/dashboards/use-dashboard-time'
export { zonedWallClock } from '@/lib/core/utils/timezone'
export {
  DASHBOARD_RANGES,
  type DashboardBlock,
  type DashboardSpec,
  type DashboardTabs,
  dashboardTableIds,
  parseDashboardSpec,
} from '@/lib/dashboards/spec'
export { useWorkspaceDashboard } from '@/hooks/queries/dashboards'
