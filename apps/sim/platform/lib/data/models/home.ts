import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import type { RecentItem } from '@sim/emcn-platform/recent-items'
import type { ComposerInventory } from '@/platform/lib/data/models/composer'
import type { HomeMode } from '@/platform/lib/data/models/shell'
import type {
  CalendarMeeting,
  HomeActivityState,
  HomeCalendarDay,
  HomeGetStartedStep,
  HomeListState,
  HomeWidgetActions,
  HomeWidgetState,
  HomeWorkspaceItem,
} from '@/platform/shared/home'

export interface AttentionItem {
  id: string
  title: string
  detail: string
  /** Absent when the item has no moment of its own, such as an account awaiting reconnection. */
  occurredAt?: number
  icon: IconName
  href?: string
  onOpen?: () => void
}

export interface EmailItem {
  id: string
  sender: string
  subject: string
  excerpt: string
  receivedAt: number
  count?: number
  /** Where this message opens in its provider. Fixture mail has none. */
  url?: string
}

/** What fixtures supply. Live data fills `HomeView` directly. */
export interface HomeData {
  asOf: number
  firstName: string
  address: string
  attention: AttentionItem[]
  /** Sorted UTC day buckets. Days omitted between the first and last bucket have zero activity. */
  activity: { date: string; tasks: number; searches: number }[]
  email: EmailItem[]
  calendar: {
    date: string
    nowMinute: number
    meetings: CalendarMeeting[]
  }
  composerInventory?: ComposerInventory
  connected: boolean
}

export interface HomeView {
  asOf: number
  greeting: string
  firstName?: string
  /**
   * Needs your attention and Workspaces wait for their design pass: absent while Home does not offer
   * them, so nothing renders or reads for either.
   */
  attention?: HomeListState<AttentionItem>
  activity: Record<HomeMode, HomeActivityState>
  email: HomeWidgetState<readonly EmailItem[]>
  calendar: HomeWidgetState<HomeCalendarDay>
  /** The viewer's workspaces, the sidebar's rows. Nothing renders for a viewer with none. */
  workspaces?: HomeListState<HomeWorkspaceItem>
  recents: HomeListState<RecentItem>
  getStarted: readonly HomeGetStartedStep[]
  composerInventory?: ComposerInventory
}

export interface HomeActions {
  email: HomeWidgetActions
  calendar: HomeWidgetActions
  openEmail: (mail: EmailItem) => void
  changeDay: (delta: number) => void
  returnToToday: () => void
  retryAttention: () => void
  retryActivity: () => void
  retryWorkspaces: () => void
  retryRecents: () => void
  removeRecent: (id: string) => void
}
