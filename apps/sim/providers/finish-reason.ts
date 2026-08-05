/**
 * Why a model stopped generating, normalized across providers.
 *
 * Providers disagree on vocabulary for the same event — a truncated generation is
 * `length` on OpenAI, `max_tokens` on Anthropic and Bedrock, and `MAX_TOKENS` on
 * Gemini. Traces keep each provider's raw string because it is the ground truth for
 * debugging; this normalized value exists so a workflow can branch on the outcome
 * without enumerating every provider's spelling.
 */
export type AgentFinishReason =
  /** Generation completed naturally, or hit a caller-supplied stop sequence. */
  | 'stop'
  /** Truncated by a token limit — the model had more to say. */
  | 'length'
  /** Stopped in order to call tools. */
  | 'tool_calls'
  /** Blocked or refused by a safety system. */
  | 'content_filter'
  /** The provider reported the generation itself as malformed. */
  | 'error'
  /** Reported, but not a case this vocabulary distinguishes. */
  | 'other'

/**
 * Raw provider value → normalized reason, keyed on the lowercased string.
 *
 * A single table rather than a per-provider mapper because the vocabularies do not
 * collide: no raw value means one thing to one provider and something else to
 * another. Sources are the SDK types this repo compiles against —
 * `ChatCompletion.finish_reason`, Anthropic's `StopReason`, Gemini's `FinishReason`,
 * and Bedrock's `StopReason`.
 */
const NORMALIZED_BY_RAW = new Map<string, AgentFinishReason>([
  // OpenAI Chat Completions, and every OpenAI-compatible provider.
  ['stop', 'stop'],
  ['length', 'length'],
  ['tool_calls', 'tool_calls'],
  ['function_call', 'tool_calls'],
  ['content_filter', 'content_filter'],

  // OpenAI Responses reports truncation through `incomplete_details.reason`.
  ['max_output_tokens', 'length'],

  // Anthropic Messages, shared by Bedrock's Converse API.
  ['end_turn', 'stop'],
  ['stop_sequence', 'stop'],
  ['max_tokens', 'length'],
  ['model_context_window_exceeded', 'length'],
  ['tool_use', 'tool_calls'],
  ['refusal', 'content_filter'],
  /** A server-tool pause is a continuation point, not an outcome. */
  ['pause_turn', 'other'],

  // Bedrock Converse additions.
  ['content_filtered', 'content_filter'],
  ['guardrail_intervened', 'content_filter'],
  ['malformed_model_output', 'error'],
  ['malformed_tool_use', 'error'],

  /**
   * Gemini. `STOP` and `MAX_TOKENS` already lowercase onto the entries above, so
   * only the values with no counterpart elsewhere are listed here. Recitation is a
   * content restriction, so it groups with the filters.
   */
  ['safety', 'content_filter'],
  ['blocklist', 'content_filter'],
  ['prohibited_content', 'content_filter'],
  ['spii', 'content_filter'],
  ['recitation', 'content_filter'],
  ['image_safety', 'content_filter'],
  ['image_prohibited_content', 'content_filter'],
  ['image_recitation', 'content_filter'],
  ['malformed_function_call', 'error'],
  ['unexpected_tool_call', 'error'],
  ['language', 'other'],
  ['other', 'other'],
  ['no_image', 'other'],
  ['image_other', 'other'],
  ['finish_reason_unspecified', 'other'],
])

/**
 * Normalizes a provider's raw stop reason.
 *
 * Returns `undefined` when the provider reported nothing, so an absent reason stays
 * distinguishable from one the vocabulary could not place. An unrecognized value maps
 * to `'other'` rather than throwing: a provider adding a case must not fail a run
 * that otherwise succeeded.
 */
export function normalizeFinishReason(
  raw: string | null | undefined
): AgentFinishReason | undefined {
  if (!raw) return undefined
  return NORMALIZED_BY_RAW.get(raw.trim().toLowerCase()) ?? 'other'
}
