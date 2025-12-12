export const CHAT_ERROR_MESSAGES = {
  GENERIC_ERROR: 'Sorry, there was an error processing your message. Please try again.',
  NETWORK_ERROR: 'Unable to connect to the server. Please check your connection and try again.',
  TIMEOUT_ERROR: 'Request timed out. Please try again.',
  AUTH_REQUIRED_PASSWORD: 'This chat requires a password to access.',
  AUTH_REQUIRED_EMAIL: 'Please provide your email to access this chat.',
  CHAT_UNAVAILABLE: 'This chat is currently unavailable. Please try again later.',
  NO_CHAT_TRIGGER:
    'No Chat trigger configured for this workflow. Add a Chat Trigger block to enable chat execution.',
  USAGE_LIMIT_EXCEEDED: 'Usage limit exceeded. Please upgrade your plan to continue using chat.',
} as const

export const CHAT_REQUEST_TIMEOUT_MS = 300000 // 5 minutes (same as in chat.tsx)

export type ChatErrorType = keyof typeof CHAT_ERROR_MESSAGES
