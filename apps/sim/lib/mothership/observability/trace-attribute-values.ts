// Sim-owned: edit here; the mothership worker does not sync this file.

// Closed-set value vocabularies for the attributes in trace-attributes.ts. Call sites
// reference e.g. `CopilotRequestCancelReason.ExplicitStop` rather than raw strings.

export const AbortBackend = {
  InProcess: 'in_process',
  Redis: 'redis',
} as const

export const BillingRouteOutcome = {
  AuthFailed: 'auth_failed',
  Billed: 'billed',
  BillingDisabled: 'billing_disabled',
  DuplicateIdempotencyKey: 'duplicate_idempotency_key',
  InternalError: 'internal_error',
  InvalidBody: 'invalid_body',
  ReconciliationRequired: 'reconciliation_required',
} as const

export const CopilotBranchKind = {
  Organization: 'organization',
  Workflow: 'workflow',
  Workspace: 'workspace',
} as const

export const CopilotChatFinalizeOutcome = {
  AppendedAssistant: 'appended_assistant',
  AssistantAlreadyPersisted: 'assistant_already_persisted',
  ClearedStreamMarkerOnly: 'cleared_stream_marker_only',
  StaleUserMessage: 'stale_user_message',
} as const

export const CopilotConfirmOutcome = {
  Delivered: 'delivered',
  Forbidden: 'forbidden',
  InternalError: 'internal_error',
  RunNotFound: 'run_not_found',
  ToolCallNotFound: 'tool_call_not_found',
  Unauthorized: 'unauthorized',
  UpdateFailed: 'update_failed',
  ValidationError: 'validation_error',
} as const

export const CopilotDegradedReason = {
  BindingRejected: 'binding_rejected',
  ClientPickupTimeout: 'client_pickup_timeout',
  MissingToolResult: 'missing_tool_result',
  StreamDeadBeforeDispatch: 'stream_dead_before_dispatch',
} as const

export type CopilotDegradedReasonValue =
  (typeof CopilotDegradedReason)[keyof typeof CopilotDegradedReason]

export const CopilotFinalizeOutcome = {
  Aborted: 'aborted',
  Error: 'error',
  Success: 'success',
} as const

export const CopilotLeg = {
  SimToWorker: 'sim_to_worker',
} as const

export const CopilotOutputFileOutcome = {
  Failed: 'failed',
  Uploaded: 'uploaded',
} as const

export const CopilotRecoveryOutcome = {
  GapDetected: 'gap_detected',
  InRange: 'in_range',
} as const

export const CopilotRequestCancelReason = {
  ExplicitStop: 'explicit_stop',
  Unknown: 'unknown',
} as const

export type CopilotRequestCancelReasonValue =
  (typeof CopilotRequestCancelReason)[keyof typeof CopilotRequestCancelReason]

export const CopilotResourcesOp = {
  Delete: 'delete',
  None: 'none',
  Upsert: 'upsert',
} as const

export const CopilotResumeOutcome = {
  BatchDelivered: 'batch_delivered',
  ClientDisconnected: 'client_disconnected',
  EndedWithoutTerminal: 'ended_without_terminal',
  StreamNotFound: 'stream_not_found',
  TerminalDelivered: 'terminal_delivered',
} as const

export const CopilotSseCloseReason = {
  Aborted: 'aborted',
  BackendError: 'backend_error',
  BillingLimit: 'billing_limit',
  ClosedNoTerminal: 'closed_no_terminal',
  Error: 'error',
  Terminal: 'terminal',
  Timeout: 'timeout',
} as const

export const CopilotStopOutcome = {
  ChatNotFound: 'chat_not_found',
  InternalError: 'internal_error',
  NoMatchingRow: 'no_matching_row',
  Persisted: 'persisted',
  Unauthorized: 'unauthorized',
  ValidationError: 'validation_error',
} as const

export const CopilotSurface = {
  Copilot: 'copilot',
  Mothership: 'mothership',
} as const

export const CopilotTableOutcome = {
  EmptyContent: 'empty_content',
  EmptyRows: 'empty_rows',
  Failed: 'failed',
  Imported: 'imported',
  InvalidJsonShape: 'invalid_json_shape',
  InvalidShape: 'invalid_shape',
  RowLimitExceeded: 'row_limit_exceeded',
  Wrote: 'wrote',
} as const

export const CopilotTableSourceFormat = {
  Csv: 'csv',
  Json: 'json',
} as const

export const CopilotTransport = {
  Batch: 'batch',
  Headless: 'headless',
  Stream: 'stream',
} as const

export const CopilotValidateOutcome = {
  InternalAuthFailed: 'internal_auth_failed',
  InternalError: 'internal_error',
  InvalidBody: 'invalid_body',
  Ok: 'ok',
  UsageExceeded: 'usage_exceeded',
  UserNotFound: 'user_not_found',
} as const

export const ToolExecutor = {
  Sim: 'sim',
} as const
