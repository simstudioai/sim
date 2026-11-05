/** What one read of a Home widget may return, whatever the provider holds. */
export const HOME_EMAIL_THREAD_LIMIT = 15
export const HOME_CALENDAR_EVENT_LIMIT = 50
export const HOME_CALENDAR_ATTENDEE_LIMIT = 8
export const HOME_TEXT_LIMITS = { name: 256, title: 512, excerpt: 512 } as const

/** Accounts one read will reach, so a viewer's account count cannot multiply provider requests. */
export const HOME_WIDGET_ACCOUNT_LIMIT = 4
