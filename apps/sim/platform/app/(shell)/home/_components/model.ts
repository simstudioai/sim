import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import type { RecentItem } from '@/platform/design-system/components/recent-items/recent-items'
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

export interface CalendarMeeting {
  id: string
  title: string
  startMinute: number
  duration: number
  providerUrl?: string
  people: { name: string }[]
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

export interface ActivityPoint {
  date: string
  value: number
}

export type HomeActivityState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'error'; retrying: boolean }
  | { status: 'ready'; points: readonly ActivityPoint[] }

export interface HomeGetStartedStep {
  id: string
  title: string
  detail: string
  href: string
  complete: boolean
}

export interface HomeView {
  /** The reference instant for relative times. */
  asOf: number
  greeting: string
  firstName?: string
  attention: HomeListState<AttentionItem>
  activity: HomeActivityState
  email: HomeWidgetState<readonly EmailItem[]>
  calendar: HomeWidgetState<HomeCalendarDay>
  recents: HomeListState<RecentItem>
  getStarted: readonly HomeGetStartedStep[]
  hiddenWidgets: readonly OrganizationHomeWidget[]
}

export interface HomeWidgetActions {
  /** Absent while the connection cannot be started, which disables its button. */
  connect?: (optionId: string) => void
  reconnect?: (accountId: string) => void
  disconnect: (accountId: string) => void | Promise<void>
  retry: () => void
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
  setWidgetHidden: (widget: OrganizationHomeWidget, hidden: boolean) => void
}
