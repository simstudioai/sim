/** Shared admission limits for interactive and scheduled context resolution. */
export const MAX_CHAT_CONTEXTS = 100
export const MAX_CHAT_CONTEXT_LABEL_LENGTH = 1000
export const MAX_CHAT_MESSAGE_LENGTH = 1024 * 1024

/** Max contexts or open-tab attachments resolved at once for one turn. */
export const CONTEXT_RESOLUTION_CONCURRENCY = 4
