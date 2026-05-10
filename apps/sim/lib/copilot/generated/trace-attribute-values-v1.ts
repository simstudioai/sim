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

type AbortBackendKey = keyof typeof AbortBackend
type AbortBackendValue = (typeof AbortBackend)[AbortBackendKey]

const AbortRedisResult = {
  Error: 'error',
  Ok: 'ok',
  Slow: 'slow',
} as const

type AbortRedisResultKey = keyof typeof AbortRedisResult
type AbortRedisResultValue = (typeof AbortRedisResult)[AbortRedisResultKey]

const AuthKeyMatch = {
  Enterprise: 'enterprise',
  None: 'none',
  User: 'user',
} as const

type AuthKeyMatchKey = keyof typeof AuthKeyMatch
type AuthKeyMatchValue = (typeof AuthKeyMatch)[AuthKeyMatchKey]

const BillingAnalyticsOutcome = {
  Duplicate: 'duplicate',
  RetriesExhausted: 'retries_exhausted',
  Success: 'success',
  Unknown: 'unknown',
} as const

type BillingAnalyticsOutcomeKey = keyof typeof BillingAnalyticsOutcome
type BillingAnalyticsOutcomeValue = (typeof BillingAnalyticsOutcome)[BillingAnalyticsOutcomeKey]

const BillingFlushOutcome = {
  CheckpointAlreadyClaimed: 'checkpoint_already_claimed',
  CheckpointLoadFailed: 'checkpoint_load_failed',
  Flushed: 'flushed',
  NoCheckpoint: 'no_checkpoint',
  NoSnapshot: 'no_snapshot',
  SkippedUnconfigured: 'skipped_unconfigured',
} as const

type BillingFlushOutcomeKey = keyof typeof BillingFlushOutcome
type BillingFlushOutcomeValue = (typeof BillingFlushOutcome)[BillingFlushOutcomeKey]

export const BillingRouteOutcome = {
  AuthFailed: 'auth_failed',
  Billed: 'billed',
  BillingDisabled: 'billing_disabled',
  DuplicateIdempotencyKey: 'duplicate_idempotency_key',
  InternalError: 'internal_error',
  InvalidBody: 'invalid_body',
} as const

type BillingRouteOutcomeKey = keyof typeof BillingRouteOutcome
type BillingRouteOutcomeValue = (typeof BillingRouteOutcome)[BillingRouteOutcomeKey]

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

type CopilotAbortOutcomeKey = keyof typeof CopilotAbortOutcome
type CopilotAbortOutcomeValue = (typeof CopilotAbortOutcome)[CopilotAbortOutcomeKey]

export const CopilotBranchKind = {
  Workflow: 'workflow',
  Workspace: 'workspace',
} as const

type CopilotBranchKindKey = keyof typeof CopilotBranchKind
type CopilotBranchKindValue = (typeof CopilotBranchKind)[CopilotBranchKindKey]

export const CopilotChatFinalizeOutcome = {
  AppendedAssistant: 'appended_assistant',
  AssistantAlreadyPersisted: 'assistant_already_persisted',
  ClearedStreamMarkerOnly: 'cleared_stream_marker_only',
  StaleUserMessage: 'stale_user_message',
} as const

type CopilotChatFinalizeOutcomeKey = keyof typeof CopilotChatFinalizeOutcome
type CopilotChatFinalizeOutcomeValue =
  (typeof CopilotChatFinalizeOutcome)[CopilotChatFinalizeOutcomeKey]

export const CopilotChatPersistOutcome = {
  Appended: 'appended',
  ChatNotFound: 'chat_not_found',
} as const

type CopilotChatPersistOutcomeKey = keyof typeof CopilotChatPersistOutcome
type CopilotChatPersistOutcomeValue =
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

type CopilotConfirmOutcomeKey = keyof typeof CopilotConfirmOutcome
type CopilotConfirmOutcomeValue = (typeof CopilotConfirmOutcome)[CopilotConfirmOutcomeKey]

export const CopilotFinalizeOutcome = {
  Aborted: 'aborted',
  Error: 'error',
  Success: 'success',
} as const

type CopilotFinalizeOutcomeKey = keyof typeof CopilotFinalizeOutcome
type CopilotFinalizeOutcomeValue = (typeof CopilotFinalizeOutcome)[CopilotFinalizeOutcomeKey]

export const CopilotLeg = {
  SimToGo: 'sim_to_go',
} as const

type CopilotLegKey = keyof typeof CopilotLeg
type CopilotLegValue = (typeof CopilotLeg)[CopilotLegKey]

export const CopilotOutputFileOutcome = {
  Failed: 'failed',
  Uploaded: 'uploaded',
} as const

type CopilotOutputFileOutcomeKey = keyof typeof CopilotOutputFileOutcome
type CopilotOutputFileOutcomeValue = (typeof CopilotOutputFileOutcome)[CopilotOutputFileOutcomeKey]

export const CopilotRecoveryOutcome = {
  GapDetected: 'gap_detected',
  InRange: 'in_range',
} as const

type CopilotRecoveryOutcomeKey = keyof typeof CopilotRecoveryOutcome
type CopilotRecoveryOutcomeValue = (typeof CopilotRecoveryOutcome)[CopilotRecoveryOutcomeKey]

export const CopilotRequestCancelReason = {
  ClientDisconnect: 'client_disconnect',
  ExplicitStop: 'explicit_stop',
  Timeout: 'timeout',
  Unknown: 'unknown',
} as const

type CopilotRequestCancelReasonKey = keyof typeof CopilotRequestCancelReason
type CopilotRequestCancelReasonValue =
  (typeof CopilotRequestCancelReason)[CopilotRequestCancelReasonKey]

const CopilotResourcesOp = {
  Delete: 'delete',
  None: 'none',
  Upsert: 'upsert',
} as const

type CopilotResourcesOpKey = keyof typeof CopilotResourcesOp
type CopilotResourcesOpValue = (typeof CopilotResourcesOp)[CopilotResourcesOpKey]

export const CopilotResumeOutcome = {
  BatchDelivered: 'batch_delivered',
  ClientDisconnected: 'client_disconnected',
  EndedWithoutTerminal: 'ended_without_terminal',
  StreamNotFound: 'stream_not_found',
  TerminalDelivered: 'terminal_delivered',
} as const

type CopilotResumeOutcomeKey = keyof typeof CopilotResumeOutcome
type CopilotResumeOutcomeValue = (typeof CopilotResumeOutcome)[CopilotResumeOutcomeKey]

export const CopilotSseCloseReason = {
  Aborted: 'aborted',
  BackendError: 'backend_error',
  BillingLimit: 'billing_limit',
  ClosedNoTerminal: 'closed_no_terminal',
  Error: 'error',
  Terminal: 'terminal',
  Timeout: 'timeout',
} as const

type CopilotSseCloseReasonKey = keyof typeof CopilotSseCloseReason
type CopilotSseCloseReasonValue = (typeof CopilotSseCloseReason)[CopilotSseCloseReasonKey]

export const CopilotStopOutcome = {
  ChatNotFound: 'chat_not_found',
  InternalError: 'internal_error',
  NoMatchingRow: 'no_matching_row',
  Persisted: 'persisted',
  Unauthorized: 'unauthorized',
  ValidationError: 'validation_error',
} as const

type CopilotStopOutcomeKey = keyof typeof CopilotStopOutcome
type CopilotStopOutcomeValue = (typeof CopilotStopOutcome)[CopilotStopOutcomeKey]

export const CopilotSurface = {
  Copilot: 'copilot',
  Mothership: 'mothership',
} as const

type CopilotSurfaceKey = keyof typeof CopilotSurface
type CopilotSurfaceValue = (typeof CopilotSurface)[CopilotSurfaceKey]

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

type CopilotTableOutcomeKey = keyof typeof CopilotTableOutcome
type CopilotTableOutcomeValue = (typeof CopilotTableOutcome)[CopilotTableOutcomeKey]

const CopilotTableSourceFormat = {
  Csv: 'csv',
  Json: 'json',
} as const

type CopilotTableSourceFormatKey = keyof typeof CopilotTableSourceFormat
type CopilotTableSourceFormatValue = (typeof CopilotTableSourceFormat)[CopilotTableSourceFormatKey]

export const CopilotTransport = {
  Batch: 'batch',
  Headless: 'headless',
  Stream: 'stream',
} as const

type CopilotTransportKey = keyof typeof CopilotTransport
type CopilotTransportValue = (typeof CopilotTransport)[CopilotTransportKey]

export const CopilotValidateOutcome = {
  InternalAuthFailed: 'internal_auth_failed',
  InternalError: 'internal_error',
  InvalidBody: 'invalid_body',
  Ok: 'ok',
  UsageExceeded: 'usage_exceeded',
  UserNotFound: 'user_not_found',
} as const

type CopilotValidateOutcomeKey = keyof typeof CopilotValidateOutcome
type CopilotValidateOutcomeValue = (typeof CopilotValidateOutcome)[CopilotValidateOutcomeKey]

export const CopilotVfsOutcome = {
  PassthroughFitsBudget: 'passthrough_fits_budget',
  PassthroughNoMetadata: 'passthrough_no_metadata',
  PassthroughNoSharp: 'passthrough_no_sharp',
  RejectedNoMetadata: 'rejected_no_metadata',
  RejectedNoSharp: 'rejected_no_sharp',
  RejectedTooLargeAfterResize: 'rejected_too_large_after_resize',
  Resized: 'resized',
} as const

type CopilotVfsOutcomeKey = keyof typeof CopilotVfsOutcome
type CopilotVfsOutcomeValue = (typeof CopilotVfsOutcome)[CopilotVfsOutcomeKey]

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

type CopilotVfsReadOutcomeKey = keyof typeof CopilotVfsReadOutcome
type CopilotVfsReadOutcomeValue = (typeof CopilotVfsReadOutcome)[CopilotVfsReadOutcomeKey]

export const CopilotVfsReadPath = {
  Binary: 'binary',
  Image: 'image',
  ParseableDocument: 'parseable_document',
  Text: 'text',
} as const

type CopilotVfsReadPathKey = keyof typeof CopilotVfsReadPath
type CopilotVfsReadPathValue = (typeof CopilotVfsReadPath)[CopilotVfsReadPathKey]

const LlmErrorStage = {
  BuildRequest: 'build_request',
  Decode: 'decode',
  HttpBuild: 'http_build',
  HttpStatus: 'http_status',
  Invoke: 'invoke',
  MarshalRequest: 'marshal_request',
  StreamClose: 'stream_close',
} as const

type LlmErrorStageKey = keyof typeof LlmErrorStage
type LlmErrorStageValue = (typeof LlmErrorStage)[LlmErrorStageKey]

const RateLimitOutcome = {
  Allowed: 'allowed',
  IncrError: 'incr_error',
  Limited: 'limited',
} as const

type RateLimitOutcomeKey = keyof typeof RateLimitOutcome
type RateLimitOutcomeValue = (typeof RateLimitOutcome)[RateLimitOutcomeKey]

const ToolAsyncWaiterResolution = {
  ContextCancelled: 'context_cancelled',
  Poll: 'poll',
  Pubsub: 'pubsub',
  StoredAfterClose: 'stored_after_close',
  StoredBeforeSubscribe: 'stored_before_subscribe',
  StoredPostSubscribe: 'stored_post_subscribe',
  SubscriptionClosed: 'subscription_closed',
  Unknown: 'unknown',
} as const

type ToolAsyncWaiterResolutionKey = keyof typeof ToolAsyncWaiterResolution
type ToolAsyncWaiterResolutionValue =
  (typeof ToolAsyncWaiterResolution)[ToolAsyncWaiterResolutionKey]

const ToolErrorKind = {
  Dispatch: 'dispatch',
  NotFound: 'not_found',
} as const

type ToolErrorKindKey = keyof typeof ToolErrorKind
type ToolErrorKindValue = (typeof ToolErrorKind)[ToolErrorKindKey]

const ToolExecutor = {
  Client: 'client',
  Go: 'go',
  Sim: 'sim',
} as const

type ToolExecutorKey = keyof typeof ToolExecutor
type ToolExecutorValue = (typeof ToolExecutor)[ToolExecutorKey]

const ToolStoreStatus = {
  Cancelled: 'cancelled',
  Completed: 'completed',
  Failed: 'failed',
  Pending: 'pending',
} as const

type ToolStoreStatusKey = keyof typeof ToolStoreStatus
type ToolStoreStatusValue = (typeof ToolStoreStatus)[ToolStoreStatusKey]
