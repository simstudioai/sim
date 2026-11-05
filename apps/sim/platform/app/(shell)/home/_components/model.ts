import type { ComposerReferences } from '@/platform/app/(shell)/_components/composer/model'
import type { HomeMode } from '@/platform/app/(shell)/_components/model'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'

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
  avatar?: string
  sender: string
  subject: string
  excerpt: string
  receivedAt: number
  count?: number
  /** Where this message opens in its provider. */
  url?: string
}

export interface CalendarMeeting {
  id: string
  title: string
  startMinute: number
  duration: number
  providerUrl?: string
  people: { name: string; src?: string }[]
}

/** What fixtures supply; the live adapter fills the same shapes from its reads. */
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
  references?: ComposerReferences
  connected: boolean
}

export interface HomeAccountView {
  id: string
  label: string
  /** Why this account is not contributing to the widget; absent when it is. */
  problem?: 'needs_reauth' | 'unavailable' | 'not_offered' | 'not_read'
  canReconnect: boolean
}

export interface HomeConnectOption {
  id: string
  label: string
  icon: IconName
}

/**
 * Every state an account-backed widget can be in. Each one renders differently, because an
 * organization that offers no email and a mailbox with no mail must never look alike.
 */
export type HomeWidgetState<T> =
  | { status: 'loading' }
  | { status: 'not_offered' }
  | { status: 'not_connected'; options: readonly HomeConnectOption[] }
  | { status: 'needs_reauth'; accounts: readonly HomeAccountView[] }
  | { status: 'error'; retrying: boolean }
  | { status: 'ready'; data: T; accounts: readonly HomeAccountView[] }

export interface HomeCalendarDay {
  date: string
  /** Null on any day but today, which is the only day with a current time. */
  nowMinute: number | null
  status: 'loading' | 'error' | 'ready'
  meetings: readonly CalendarMeeting[]
  allDay: readonly { id: string; title: string; providerUrl?: string }[]
}

export type HomeListState<T> =
  | { status: 'loading' }
  | { status: 'error'; retrying: boolean }
  | { status: 'ready'; items: readonly T[]; partial?: boolean }

export type HomeActivityState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'error'; retrying: boolean }
  | { status: 'ready'; points?: readonly { date: string; value: number }[] }

export interface HomeGetStartedStep {
  id: string
  title: string
  detail: string
  href: string
  complete: boolean
}

export interface HomeView {
  /** The reference instant for relative times. Null until the viewer's clock is known. */
  asOf: number | null
  greeting: string
  firstName?: string
  attention: HomeListState<AttentionItem>
  activity: Record<HomeMode, HomeActivityState>
  email: HomeWidgetState<readonly EmailItem[]>
  calendar: HomeWidgetState<HomeCalendarDay>
  recents: HomeListState<RecentItem>
  getStarted: readonly HomeGetStartedStep[]
  references?: ComposerReferences
}

export interface HomeWidgetActions {
  /** Absent while the connection cannot be started, which disables its button. */
  connect?: (optionId: string) => void
  reconnect?: (accountId: string) => void
  disconnect?: (accountId: string) => void | Promise<void>
  retry?: () => void
  /** A live disconnect reaches further than this widget, and the dialog has to say so. */
  disconnectNotice?: string
  /** The connected address a session disconnect names, when there is one. */
  address?: string
}

export interface HomeActions {
  email: HomeWidgetActions
  calendar: HomeWidgetActions
  openEmail: (mail: EmailItem) => void
  changeDay: (delta: number) => void
  returnToToday: () => void
  retryAttention?: () => void
  retryActivity?: () => void
  retryRecents?: () => void
  removeRecent: (id: string) => void
}
