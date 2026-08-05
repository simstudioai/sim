/**
 * @vitest-environment node
 *
 * The raw values are taken from the SDK enums this repo compiles against:
 * `ChatCompletion.finish_reason`, Anthropic `StopReason`, Gemini `FinishReason`,
 * and Bedrock `StopReason`. A provider adding a case must not fail a run, so an
 * unknown value normalizes rather than throwing.
 */
import { describe, expect, it } from 'vitest'
import { normalizeFinishReason } from '@/providers/finish-reason'

describe('normalizeFinishReason', () => {
  it('reports nothing when the provider reported nothing', () => {
    expect(normalizeFinishReason(undefined)).toBeUndefined()
    expect(normalizeFinishReason(null)).toBeUndefined()
    expect(normalizeFinishReason('')).toBeUndefined()
  })

  /** The case this exists for: one branch catches truncation on every provider. */
  it('maps every provider spelling of truncation to length', () => {
    expect(normalizeFinishReason('length')).toBe('length') // OpenAI chat
    expect(normalizeFinishReason('max_output_tokens')).toBe('length') // OpenAI Responses
    expect(normalizeFinishReason('max_tokens')).toBe('length') // Anthropic, Bedrock
    expect(normalizeFinishReason('MAX_TOKENS')).toBe('length') // Gemini
    expect(normalizeFinishReason('model_context_window_exceeded')).toBe('length')
  })

  it('maps natural completion to stop', () => {
    expect(normalizeFinishReason('stop')).toBe('stop')
    expect(normalizeFinishReason('STOP')).toBe('stop')
    expect(normalizeFinishReason('end_turn')).toBe('stop')
    expect(normalizeFinishReason('stop_sequence')).toBe('stop')
  })

  it('maps tool stops to tool_calls', () => {
    expect(normalizeFinishReason('tool_calls')).toBe('tool_calls')
    expect(normalizeFinishReason('function_call')).toBe('tool_calls')
    expect(normalizeFinishReason('tool_use')).toBe('tool_calls')
  })

  it('maps every safety stop to content_filter', () => {
    for (const raw of [
      'content_filter',
      'content_filtered',
      'guardrail_intervened',
      'refusal',
      'SAFETY',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
      'RECITATION',
      'IMAGE_SAFETY',
    ]) {
      expect(normalizeFinishReason(raw)).toBe('content_filter')
    }
  })

  it('maps malformed generations to error', () => {
    expect(normalizeFinishReason('MALFORMED_FUNCTION_CALL')).toBe('error')
    expect(normalizeFinishReason('malformed_tool_use')).toBe('error')
    expect(normalizeFinishReason('malformed_model_output')).toBe('error')
  })

  /** A pause is a continuation point, not an outcome the caller should branch on. */
  it('does not treat a server-tool pause as a stop', () => {
    expect(normalizeFinishReason('pause_turn')).toBe('other')
  })

  /**
   * Values confirmed against each vendor's own enum by a per-provider documentation
   * sweep. Several are the routine success path on open-weight models, so leaving
   * them unclassified would misreport healthy runs.
   */
  it('classifies the non-OpenAI vocabularies of compatible vendors', () => {
    expect(normalizeFinishReason('model_length')).toBe('length') // Mistral
    expect(normalizeFinishReason('eos')).toBe('stop') // Together
    expect(normalizeFinishReason('eos_token')).toBe('stop') // LiteLLM/HuggingFace
    expect(normalizeFinishReason('error')).toBe('error') // Mistral, OpenRouter, Together
    expect(normalizeFinishReason('insufficient_system_resource')).toBe('error') // DeepSeek
    expect(normalizeFinishReason('network_error')).toBe('error') // Z.ai
    expect(normalizeFinishReason('sensitive')).toBe('content_filter') // Z.ai
  })

  it('classifies the Gemini and Vertex values absent from the TS enum', () => {
    expect(normalizeFinishReason('MODEL_ARMOR')).toBe('content_filter') // Vertex only
    expect(normalizeFinishReason('ESCALATION')).toBe('content_filter')
    expect(normalizeFinishReason('MALFORMED_RESPONSE')).toBe('error')
    expect(normalizeFinishReason('MISSING_THOUGHT_SIGNATURE')).toBe('error')
  })

  /**
   * A server-aborted tool loop is not a request to execute tools, and a repetition
   * cutoff is a normal finish rather than a failure — both would mislead a workflow
   * branching on the value.
   */
  it('does not overclaim on aborted or degenerate stops', () => {
    expect(normalizeFinishReason('too_many_tool_calls')).toBe('other')
    expect(normalizeFinishReason('repetition')).toBe('other')
    expect(normalizeFinishReason('abort')).toBe('other')
  })

  it('degrades an unrecognized value to other rather than throwing', () => {
    expect(normalizeFinishReason('some_future_reason')).toBe('other')
    expect(normalizeFinishReason('OTHER')).toBe('other')
    expect(normalizeFinishReason('FINISH_REASON_UNSPECIFIED')).toBe('other')
  })

  it('is insensitive to case and surrounding whitespace', () => {
    expect(normalizeFinishReason('  Length  ')).toBe('length')
  })
})
