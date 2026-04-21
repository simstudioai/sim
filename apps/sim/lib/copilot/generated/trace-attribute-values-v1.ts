// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/trace-attribute-values-v1.schema.json
// Regenerate with: bun run trace-attribute-values-contract:generate
//
// Canonical closed-set value vocabularies for mothership OTel
// attributes. Call sites should reference e.g.
// `CopilotRequestCancelReason.ExplicitStop` rather than the raw
// string literal, so typos become compile errors and the Go contract
// remains the single source of truth.

export const AbortBackend = {
  InProcess: 'in_process',
  Redis: 'redis',
} as const

export type AbortBackendKey = keyof typeof AbortBackend
export type AbortBackendValue = (typeof AbortBackend)[AbortBackendKey]

export const AbortRedisResult = {
  Error: 'error',
  Ok: 'ok',
  Slow: 'slow',
} as const

export type AbortRedisResultKey = keyof typeof AbortRedisResult
export type AbortRedisResultValue = (typeof AbortRedisResult)[AbortRedisResultKey]

export const AuthKeyMatch = {
  Enterprise: 'enterprise',
  None: 'none',
  User: 'user',
} as const

export type AuthKeyMatchKey = keyof typeof AuthKeyMatch
export type AuthKeyMatchValue = (typeof AuthKeyMatch)[AuthKeyMatchKey]

export const BillingAnalyticsOutcome = {
  Duplicate: 'duplicate',
  RetriesExhausted: 'retries_exhausted',
  Success: 'success',
  Unknown: 'unknown',
} as const

export type BillingAnalyticsOutcomeKey = keyof typeof BillingAnalyticsOutcome
export type BillingAnalyticsOutcomeValue =
  (typeof BillingAnalyticsOutcome)[BillingAnalyticsOutcomeKey]

export const BillingFlushOutcome = {
  CheckpointAlreadyClaimed: 'checkpoint_already_claimed',
  CheckpointLoadFailed: 'checkpoint_load_failed',
  Flushed: 'flushed',
  NoCheckpoint: 'no_checkpoint',
  NoSnapshot: 'no_snapshot',
  SkippedUnconfigured: 'skipped_unconfigured',
} as const

export type BillingFlushOutcomeKey = keyof typeof BillingFlushOutcome
export type BillingFlushOutcomeValue = (typeof BillingFlushOutcome)[BillingFlushOutcomeKey]

export const BillingRouteOutcome = {
  AuthFailed: 'auth_failed',
  Billed: 'billed',
  BillingDisabled: 'billing_disabled',
  DuplicateIdempotencyKey: 'duplicate_idempotency_key',
  InternalError: 'internal_error',
  InvalidBody: 'invalid_body',
} as const

export type BillingRouteOutcomeKey = keyof typeof BillingRouteOutcome
export type BillingRouteOutcomeValue = (typeof BillingRouteOutcome)[BillingRouteOutcomeKey]

export const CopilotAbortOutcome = {
  BadRequest: 'bad_request',
  FallbackPersistFailed: 'fallback_persist_failed',
  MissingMessageId: 'missing_message_id',
  MissingStreamId: 'missing_stream_id',
  NoChatId: 'no_chat_id',
  Ok: 'ok',
  SettleTimeout: 'settle_timeout',
  Settled: 'settled',
  Unauthorized: 'unauthorized',
} as const

export type CopilotAbortOutcomeKey = keyof typeof CopilotAbortOutcome
export type CopilotAbortOutcomeValue = (typeof CopilotAbortOutcome)[CopilotAbortOutcomeKey]

export const CopilotBranchKind = {
  Workflow: 'workflow',
  Workspace: 'workspace',
} as const

export type CopilotBranchKindKey = keyof typeof CopilotBranchKind
export type CopilotBranchKindValue = (typeof CopilotBranchKind)[CopilotBranchKindKey]

export const CopilotChatFinalizeOutcome = {
  AppendedAssistant: 'appended_assistant',
  AssistantAlreadyPersisted: 'assistant_already_persisted',
  ClearedStreamMarkerOnly: 'cleared_stream_marker_only',
  StaleUserMessage: 'stale_user_message',
} as const

export type CopilotChatFinalizeOutcomeKey = keyof typeof CopilotChatFinalizeOutcome
export type CopilotChatFinalizeOutcomeValue =
  (typeof CopilotChatFinalizeOutcome)[CopilotChatFinalizeOutcomeKey]

export const CopilotChatPersistOutcome = {
  Appended: 'appended',
  ChatNotFound: 'chat_not_found',
} as const

export type CopilotChatPersistOutcomeKey = keyof typeof CopilotChatPersistOutcome
export type CopilotChatPersistOutcomeValue =
  (typeof CopilotChatPersistOutcome)[CopilotChatPersistOutcomeKey]

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

export type CopilotConfirmOutcomeKey = keyof typeof CopilotConfirmOutcome
export type CopilotConfirmOutcomeValue = (typeof CopilotConfirmOutcome)[CopilotConfirmOutcomeKey]

export const CopilotFinalizeOutcome = {
  Aborted: 'aborted',
  Error: 'error',
  Success: 'success',
} as const

export type CopilotFinalizeOutcomeKey = keyof typeof CopilotFinalizeOutcome
export type CopilotFinalizeOutcomeValue = (typeof CopilotFinalizeOutcome)[CopilotFinalizeOutcomeKey]

export const CopilotLeg = {
  SimToGo: 'sim_to_go',
} as const

export type CopilotLegKey = keyof typeof CopilotLeg
export type CopilotLegValue = (typeof CopilotLeg)[CopilotLegKey]

export const CopilotOutputFileOutcome = {
  Failed: 'failed',
  Uploaded: 'uploaded',
} as const

export type CopilotOutputFileOutcomeKey = keyof typeof CopilotOutputFileOutcome
export type CopilotOutputFileOutcomeValue =
  (typeof CopilotOutputFileOutcome)[CopilotOutputFileOutcomeKey]

export const CopilotRecoveryOutcome = {
  GapDetected: 'gap_detected',
  InRange: 'in_range',
} as const

export type CopilotRecoveryOutcomeKey = keyof typeof CopilotRecoveryOutcome
export type CopilotRecoveryOutcomeValue = (typeof CopilotRecoveryOutcome)[CopilotRecoveryOutcomeKey]

export const CopilotRequestCancelReason = {
  ClientDisconnect: 'client_disconnect',
  ExplicitStop: 'explicit_stop',
  Timeout: 'timeout',
  Unknown: 'unknown',
} as const

export type CopilotRequestCancelReasonKey = keyof typeof CopilotRequestCancelReason
export type CopilotRequestCancelReasonValue =
  (typeof CopilotRequestCancelReason)[CopilotRequestCancelReasonKey]

export const CopilotResourcesOp = {
  Delete: 'delete',
  None: 'none',
  Upsert: 'upsert',
} as const

export type CopilotResourcesOpKey = keyof typeof CopilotResourcesOp
export type CopilotResourcesOpValue = (typeof CopilotResourcesOp)[CopilotResourcesOpKey]

export const CopilotResumeOutcome = {
  BatchDelivered: 'batch_delivered',
  ClientDisconnected: 'client_disconnected',
  EndedWithoutTerminal: 'ended_without_terminal',
  StreamNotFound: 'stream_not_found',
  TerminalDelivered: 'terminal_delivered',
} as const

export type CopilotResumeOutcomeKey = keyof typeof CopilotResumeOutcome
export type CopilotResumeOutcomeValue = (typeof CopilotResumeOutcome)[CopilotResumeOutcomeKey]

export const CopilotSseCloseReason = {
  Aborted: 'aborted',
  BackendError: 'backend_error',
  BillingLimit: 'billing_limit',
  ClosedNoTerminal: 'closed_no_terminal',
  Error: 'error',
  Terminal: 'terminal',
  Timeout: 'timeout',
} as const

export type CopilotSseCloseReasonKey = keyof typeof CopilotSseCloseReason
export type CopilotSseCloseReasonValue = (typeof CopilotSseCloseReason)[CopilotSseCloseReasonKey]

export const CopilotStopOutcome = {
  ChatNotFound: 'chat_not_found',
  InternalError: 'internal_error',
  NoMatchingRow: 'no_matching_row',
  Persisted: 'persisted',
  Unauthorized: 'unauthorized',
  ValidationError: 'validation_error',
} as const

export type CopilotStopOutcomeKey = keyof typeof CopilotStopOutcome
export type CopilotStopOutcomeValue = (typeof CopilotStopOutcome)[CopilotStopOutcomeKey]

export const CopilotSurface = {
  Copilot: 'copilot',
  Mothership: 'mothership',
} as const

export type CopilotSurfaceKey = keyof typeof CopilotSurface
export type CopilotSurfaceValue = (typeof CopilotSurface)[CopilotSurfaceKey]

export const CopilotTableOutcome = {
  EmptyContent: 'empty_content',
  EmptyRows: 'empty_rows',
  Failed: 'failed',
  Imported: 'imported',
  InvalidJsonShape: 'invalid_json_shape',
  InvalidShape: 'invalid_shape',
  RowLimitExceeded: 'row_limit_exceeded',
  TableNotFound: 'table_not_found',
  Wrote: 'wrote',
} as const

export type CopilotTableOutcomeKey = keyof typeof CopilotTableOutcome
export type CopilotTableOutcomeValue = (typeof CopilotTableOutcome)[CopilotTableOutcomeKey]

export const CopilotTableSourceFormat = {
  Csv: 'csv',
  Json: 'json',
} as const

export type CopilotTableSourceFormatKey = keyof typeof CopilotTableSourceFormat
export type CopilotTableSourceFormatValue =
  (typeof CopilotTableSourceFormat)[CopilotTableSourceFormatKey]

export const CopilotTransport = {
  Batch: 'batch',
  Headless: 'headless',
  Stream: 'stream',
} as const

export type CopilotTransportKey = keyof typeof CopilotTransport
export type CopilotTransportValue = (typeof CopilotTransport)[CopilotTransportKey]

export const CopilotValidateOutcome = {
  InternalAuthFailed: 'internal_auth_failed',
  InternalError: 'internal_error',
  InvalidBody: 'invalid_body',
  Ok: 'ok',
  UsageExceeded: 'usage_exceeded',
  UserNotFound: 'user_not_found',
} as const

export type CopilotValidateOutcomeKey = keyof typeof CopilotValidateOutcome
export type CopilotValidateOutcomeValue = (typeof CopilotValidateOutcome)[CopilotValidateOutcomeKey]

export const CopilotVfsOutcome = {
  PassthroughFitsBudget: 'passthrough_fits_budget',
  PassthroughNoMetadata: 'passthrough_no_metadata',
  PassthroughNoSharp: 'passthrough_no_sharp',
  RejectedNoMetadata: 'rejected_no_metadata',
  RejectedNoSharp: 'rejected_no_sharp',
  RejectedTooLargeAfterResize: 'rejected_too_large_after_resize',
  Resized: 'resized',
} as const

export type CopilotVfsOutcomeKey = keyof typeof CopilotVfsOutcome
export type CopilotVfsOutcomeValue = (typeof CopilotVfsOutcome)[CopilotVfsOutcomeKey]

export const CopilotVfsReadOutcome = {
  BinaryPlaceholder: 'binary_placeholder',
  DocumentParsed: 'document_parsed',
  DocumentTooLarge: 'document_too_large',
  ImagePrepared: 'image_prepared',
  ImageTooLarge: 'image_too_large',
  ParseFailed: 'parse_failed',
  ReadFailed: 'read_failed',
  TextRead: 'text_read',
  TextTooLarge: 'text_too_large',
} as const

export type CopilotVfsReadOutcomeKey = keyof typeof CopilotVfsReadOutcome
export type CopilotVfsReadOutcomeValue = (typeof CopilotVfsReadOutcome)[CopilotVfsReadOutcomeKey]

export const CopilotVfsReadPath = {
  Binary: 'binary',
  Image: 'image',
  ParseableDocument: 'parseable_document',
  Text: 'text',
} as const

export type CopilotVfsReadPathKey = keyof typeof CopilotVfsReadPath
export type CopilotVfsReadPathValue = (typeof CopilotVfsReadPath)[CopilotVfsReadPathKey]

export const LlmErrorStage = {
  BuildRequest: 'build_request',
  Decode: 'decode',
  HttpBuild: 'http_build',
  HttpStatus: 'http_status',
  Invoke: 'invoke',
  MarshalRequest: 'marshal_request',
  StreamClose: 'stream_close',
} as const

export type LlmErrorStageKey = keyof typeof LlmErrorStage
export type LlmErrorStageValue = (typeof LlmErrorStage)[LlmErrorStageKey]

export const RateLimitOutcome = {
  Allowed: 'allowed',
  IncrError: 'incr_error',
  Limited: 'limited',
} as const

export type RateLimitOutcomeKey = keyof typeof RateLimitOutcome
export type RateLimitOutcomeValue = (typeof RateLimitOutcome)[RateLimitOutcomeKey]

export const ToolAsyncWaiterResolution = {
  ContextCancelled: 'context_cancelled',
  Poll: 'poll',
  Pubsub: 'pubsub',
  StoredAfterClose: 'stored_after_close',
  StoredBeforeSubscribe: 'stored_before_subscribe',
  StoredPostSubscribe: 'stored_post_subscribe',
  SubscriptionClosed: 'subscription_closed',
  Unknown: 'unknown',
} as const

export type ToolAsyncWaiterResolutionKey = keyof typeof ToolAsyncWaiterResolution
export type ToolAsyncWaiterResolutionValue =
  (typeof ToolAsyncWaiterResolution)[ToolAsyncWaiterResolutionKey]

export const ToolErrorKind = {
  Dispatch: 'dispatch',
  NotFound: 'not_found',
} as const

export type ToolErrorKindKey = keyof typeof ToolErrorKind
export type ToolErrorKindValue = (typeof ToolErrorKind)[ToolErrorKindKey]

export const ToolExecutor = {
  Client: 'client',
  Go: 'go',
  Sim: 'sim',
} as const

export type ToolExecutorKey = keyof typeof ToolExecutor
export type ToolExecutorValue = (typeof ToolExecutor)[ToolExecutorKey]

export const ToolStoreStatus = {
  Cancelled: 'cancelled',
  Completed: 'completed',
  Failed: 'failed',
  Pending: 'pending',
} as const

export type ToolStoreStatusKey = keyof typeof ToolStoreStatus
export type ToolStoreStatusValue = (typeof ToolStoreStatus)[ToolStoreStatusKey]
