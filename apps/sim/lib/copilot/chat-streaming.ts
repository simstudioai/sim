/**
 * Re-exported from request/lifecycle/start.ts for backward compatibility.
 * New code should import from '@/lib/copilot/request/lifecycle/start' directly.
 */

export type { StreamingOrchestrationParams } from '@/lib/copilot/request/lifecycle/start'
export {
  createSSEStream,
  requestChatTitle,
  SSE_RESPONSE_HEADERS,
} from '@/lib/copilot/request/lifecycle/start'
export { abortActiveStream } from '@/lib/copilot/request/session/abort'
