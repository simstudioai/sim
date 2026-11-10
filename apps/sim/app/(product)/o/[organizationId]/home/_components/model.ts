import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import type { RecentItem } from '@sim/emcn-platform/recent-items'
import type { ComposerInventory } from '@/app/(product)/_components/composer/model'
import type { HomeMode } from '@/app/(product)/_components/model'
import type {
  CalendarMeeting,
  HomeActivityState,
  HomeCalendarDay,
  HomeGetStartedStep,
  HomeListState,
  HomeWidgetActions,
  HomeWidgetState,
} from '@/platform/shared/home'

/**
 * Home sections held back by design until the designer's pass. Their views stay; Home renders none
 * of them and the live Home skips their reads.
 */
export const HOME_HIDDEN_SECTIONS: ReadonlySet<'Needs your attention'> = new Set([
  'Needs your attention',
])

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
  attention: HomeListState<AttentionItem>
  activity: Record<HomeMode, HomeActivityState>
  email: HomeWidgetState<readonly EmailItem[]>
  calendar: HomeWidgetState<HomeCalendarDay>
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
  retryRecents: () => void
  removeRecent: (id: string) => void
}
