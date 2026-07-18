/**
 * Cross-repo contract for Full-stack mothership chats.
 *
 * sim-agent (Go) owns: tool schemas, prompts, stream event shapes.
 * This repo (Sim) owns: handlers, storage, preview bridge, Apps UI.
 *
 * Status: Go owns schemas/prompts/stream envelopes; Sim owns handlers/storage/UI.
 * Handlers still return `{ event: { type, payload } }` in tool results so Go can
 * mirror them into typed `app` stream events. Sim fails closed: only this
 * allowlist executes for requestMode=fullstack, and workflow mutation tools are
 * rejected before dispatch.
 */

export const FULLSTACK_CHAT_TYPE = 'fullstack' as const

/** Tools the Go agent may invoke; Sim implements the handlers. */
export const FULLSTACK_TOOL_NAMES = [
  'app_bind_action',
  'app_refresh_binding',
  'app_detach_action',
  'app_write_files',
  'app_build',
  'app_prepare_publish',
  'app_list_callable_releases',
] as const

export type FullstackToolName = (typeof FULLSTACK_TOOL_NAMES)[number]

/** Stream lifecycle events (names stable for Go ↔ Sim). */
export const FULLSTACK_STREAM_EVENTS = [
  'app.generation.started',
  'app.generation.failed',
  'app.frontend.generated',
  'app.revision.created',
  'app.build.finished',
  'app.deploy.started',
  'app.deploy.failed',
  'app.release.prepared',
  'app.release.published',
  'app.release.revoked',
  'app.binding.drift',
  'app.preview.ready',
] as const

export type FullstackStreamEvent = (typeof FULLSTACK_STREAM_EVENTS)[number]

export type FullstackToolAllowlist = {
  chatType: typeof FULLSTACK_CHAT_TYPE
  tools: readonly FullstackToolName[]
  /** Explicitly excluded — Full-stack v1 must not mutate workflow graphs. */
  denied: readonly ['create_workflow', 'edit_workflow', 'delete_workflow']
}

export const FULLSTACK_TOOL_ALLOWLIST: FullstackToolAllowlist = {
  chatType: FULLSTACK_CHAT_TYPE,
  tools: FULLSTACK_TOOL_NAMES,
  denied: ['create_workflow', 'edit_workflow', 'delete_workflow'],
}
