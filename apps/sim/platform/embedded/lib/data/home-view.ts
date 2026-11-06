import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import type {
  HomeActivityState,
  HomeCalendarDay,
  HomeGetStartedStep,
  HomeListState,
  HomeWidgetActions,
  HomeWidgetState,
} from '@/platform/shared/home'
import type { OrganizationHomeWidget } from '@/stores/organization-home/store'

export type AttentionItem = {
  id: string
  title: string
  detail: string
  /** Absent when the item has no moment of its own, such as an account awaiting reconnection. */
  occurredAt?: number
  icon: IconName
} & ({ href: string; onOpen?: never } | { href?: never; onOpen: () => void })

export interface EmailItem {
  id: string
  sender: string
  subject: string
  excerpt: string
  receivedAt: number
  count?: number
  url: string
}

/** The chart's windows, narrowest first. All are daily buckets. */
export const ACTIVITY_WINDOW_DAYS = [7, 30, 90] as const
export type ActivityWindowDays = (typeof ACTIVITY_WINDOW_DAYS)[number]

export interface HomeWorkspaceItem {
  id: string
  name: string
  href: string
  /** Absent while the viewer's activity read has nothing to say about this workspace. */
  detail?: string
  status?: 'review' | 'running'
  /** Shown in place of a status, as when the newest run started. */
  lastRunAt?: number
}

/** One chip on Home's Recents: every visit it stands for, so removing it removes them all. */
export interface HomeRecentItem {
  id: string
  label: string
  href: string
  icon?: IconName
  /** Where to look up an icon, for a source with no provider mark. */
  host: string | null
  urls: readonly string[]
}

export interface HomeView {
  asOf: number
  greeting: string
  firstName?: string
  attention: HomeListState<AttentionItem>
  activity: HomeActivityState
  activityDays: ActivityWindowDays
  email: HomeWidgetState<readonly EmailItem[]>
  calendar: HomeWidgetState<HomeCalendarDay>
  /** The viewer's workspaces, the sidebar's rows. Nothing renders for a viewer with none. */
  workspaces: HomeListState<HomeWorkspaceItem>
  workspaceCount: number
  recents: HomeListState<HomeRecentItem>
  getStarted: readonly HomeGetStartedStep[]
  hiddenWidgets: readonly OrganizationHomeWidget[]
}

export interface HomeActions {
  email: HomeWidgetActions
  calendar: HomeWidgetActions
  openEmail: (mail: EmailItem) => void
  changeDay: (delta: number) => void
  returnToToday: () => void
  retryAttention: () => void
  retryActivity: () => void
  setActivityDays: (days: ActivityWindowDays) => void
  retryWorkspaces: () => void
  retryRecents: () => void
  removeRecent: (id: string) => void
  setWidgetHidden: (widget: OrganizationHomeWidget, hidden: boolean) => void
}
