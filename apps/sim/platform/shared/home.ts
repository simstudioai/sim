import type { IconName } from '@sim/emcn/catalog/icon-geometry'

export interface CalendarMeeting {
  id: string
  title: string
  startMinute: number
  duration: number
  /** The meeting's own wall clock, when it runs past the edges of this day. */
  clock?: { startMinute: number; endMinute: number }
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
  | {
      status: 'ready'
      items: readonly T[]
      partial?: boolean
      /** The rows are final, but what they report is still being read. */
      settling?: boolean
    }

export interface ActivityPoint {
  date: string
  value: number
}

export type HomeActivityState =
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'error'; retrying: boolean }
  | { status: 'ready'; points: readonly ActivityPoint[] }

/** A suggested action under Home's composer: a prompt to start from, or a service to connect. */
export type HomeSuggestion =
  | { kind: 'prompt'; id: string; label: string; prompt: string; providerId?: string }
  | { kind: 'integration'; id: string; label: string; providerId: string; href: string }

export interface HomeGetStartedStep {
  id: string
  title: string
  detail: string
  href: string
  complete: boolean
}

export interface HomeWidgetActions {
  /** Absent while the connection cannot be started, which disables its button. */
  connect?: (optionId: string) => void
  reconnect?: (accountId: string) => void
  disconnect: (accountId: string) => void | Promise<void>
  retry: () => void
}
