import { describe, expect, it } from 'vitest'
import {
  getMaxTemperature,
  PROVIDERS_WITH_TOOL_USAGE_CONTROL,
  supportsTemperature,
  supportsToolUsageControl,
} from './model-capabilities'

describe('supportsToolUsageControl', () => {
  it('should return true for providers that support tool usage control', () => {
    // Test each provider that should support tool usage control
    for (const provider of PROVIDERS_WITH_TOOL_USAGE_CONTROL) {
      expect(supportsToolUsageControl(provider)).toBe(true)
    }
  })

  it('should return false for providers that do not support tool usage control', () => {
    const unsupportedProviders = ['google', 'ollama', 'non-existent-provider']

    for (const provider of unsupportedProviders) {
      expect(supportsToolUsageControl(provider)).toBe(false)
    }
  })
})

describe('supportsTemperature', () => {
  it('should return true for models that support temperature', () => {
    const supportedModels = [
      'gpt-4o',
      'gemini-2.5-flash-preview-04-17',
      'claude-3-5-sonnet-20240620',
      `grok-3-latest`,
      `grok-3-fast-latest`
    ]

    for (const model of supportedModels) {
      expect(supportsTemperature(model)).toBe(true)
    }
  })

  it('should return false for models that do not support temperature', () => {
    const unsupportedModels = ['unsupported-model']

    for (const model of unsupportedModels) {
      expect(supportsTemperature(model)).toBe(false)
    }
  })
})

describe('getMaxTemperature', () => {
  it('should return 2 for models with temperature range 0-2', () => {
    const models = ['gpt-4o', 'gemini-2.5-flash-preview-04-17', 'deepseek-v3']

    for (const model of models) {
      expect(getMaxTemperature(model)).toBe(2)
    }
  })

  it('should return 1 for models with temperature range 0-1', () => {
    const models = ['claude-3-5-sonnet-20240620', 'claude-3-7-sonnet-20250219', 'grok-3-latest', 'grok-3-fast-latest']

    for (const model of models) {
      expect(getMaxTemperature(model)).toBe(1)
    }
  })

  it('should return undefined for models that do not support temperature', () => {
    expect(getMaxTemperature('unsupported-model')).toBeUndefined()
  })
})
