/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getBedrockInferenceProfileId, supportsToolResultStatus } from '@/providers/bedrock/utils'

describe('getBedrockInferenceProfileId', () => {
  it.concurrent('prefixes geo inference profile for models that require it', () => {
    expect(
      getBedrockInferenceProfileId('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0', 'us-east-1')
    ).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(getBedrockInferenceProfileId('bedrock/amazon.nova-pro-v1:0', 'eu-west-1')).toBe(
      'eu.amazon.nova-pro-v1:0'
    )
    expect(
      getBedrockInferenceProfileId('bedrock/meta.llama4-scout-17b-instruct-v1:0', 'us-west-2')
    ).toBe('us.meta.llama4-scout-17b-instruct-v1:0')
  })

  it.concurrent('returns already-prefixed inference profile IDs unchanged', () => {
    expect(
      getBedrockInferenceProfileId('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'us-east-1')
    ).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(getBedrockInferenceProfileId('global.amazon.nova-2-lite-v1:0', 'us-east-1')).toBe(
      'global.amazon.nova-2-lite-v1:0'
    )
  })

  it.concurrent('returns the bare model ID for models without geo profile support', () => {
    expect(
      getBedrockInferenceProfileId('bedrock/mistral.mistral-large-3-675b-instruct', 'us-east-1')
    ).toBe('mistral.mistral-large-3-675b-instruct')
    expect(
      getBedrockInferenceProfileId('bedrock/mistral.ministral-3-8b-instruct', 'eu-west-1')
    ).toBe('mistral.ministral-3-8b-instruct')
    expect(getBedrockInferenceProfileId('bedrock/cohere.command-r-plus-v1:0', 'us-east-1')).toBe(
      'cohere.command-r-plus-v1:0'
    )
    expect(
      getBedrockInferenceProfileId('bedrock/mistral.mixtral-8x7b-instruct-v0:1', 'ap-southeast-1')
    ).toBe('mistral.mixtral-8x7b-instruct-v0:1')
    expect(
      getBedrockInferenceProfileId('bedrock/amazon.titan-text-premier-v1:0', 'us-east-1')
    ).toBe('amazon.titan-text-premier-v1:0')
  })
})

describe('supportsToolResultStatus', () => {
  it.concurrent('accepts Claude and Nova through every ID form', () => {
    expect(supportsToolResultStatus('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true)
    expect(supportsToolResultStatus('us.anthropic.claude-opus-4-5-20251101-v1:0')).toBe(true)
    expect(supportsToolResultStatus('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true)
    expect(supportsToolResultStatus('global.amazon.nova-2-lite-v1:0')).toBe(true)
    expect(supportsToolResultStatus('bedrock/amazon.nova-micro-v1:0')).toBe(true)
  })

  it.concurrent('rejects every family that returns a ValidationException for it', () => {
    expect(supportsToolResultStatus('us.meta.llama4-scout-17b-instruct-v1:0')).toBe(false)
    expect(supportsToolResultStatus('bedrock/meta.llama3-3-70b-instruct-v1:0')).toBe(false)
    expect(supportsToolResultStatus('mistral.mistral-large-2407-v1:0')).toBe(false)
    expect(supportsToolResultStatus('cohere.command-r-plus-v1:0')).toBe(false)
    // Titan shares the amazon vendor prefix but is not Nova.
    expect(supportsToolResultStatus('bedrock/amazon.titan-text-premier-v1:0')).toBe(false)
  })
})
