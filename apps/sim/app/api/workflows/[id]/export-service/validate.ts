/**
 * Workflow validation utilities for export service.
 */

// Supported block types for export
export const SUPPORTED_BLOCK_TYPES = new Set([
  'start_trigger',
  'start',
  'agent',
  'function',
  'condition',
  'router',
  'api',
  'variables',
  'response',
  'loop',
  'loop_block',
])

// Supported providers for agent blocks
export const SUPPORTED_PROVIDERS = new Set(['anthropic', 'openai', 'google'])

/**
 * Detect LLM provider from model name.
 */
export function detectProviderFromModel(model: string): string {
  const modelLower = model.toLowerCase()
  if (modelLower.includes('claude')) return 'anthropic'
  // Match gpt-*, o1-*, o3-* but not o10, o11, etc. using regex word boundary
  if (modelLower.includes('gpt') || /\bo1-/.test(modelLower) || /\bo3-/.test(modelLower))
    return 'openai'
  if (modelLower.includes('gemini')) return 'google'
  return 'unknown'
}

export interface ValidationResult {
  valid: boolean
  unsupportedBlocks: Array<{ id: string; name: string; type: string }>
  unsupportedProviders: Array<{ id: string; name: string; model: string; provider: string }>
  message: string
}

// Type for workflow block during validation
export interface WorkflowBlock {
  type: string
  name?: string
  subBlocks?: {
    model?: { value?: string }
    [key: string]: unknown
  }
  inputs?: {
    model?: string
    [key: string]: unknown
  }
}

// Type for workflow state
export interface WorkflowState {
  blocks?: Record<string, WorkflowBlock>
  edges?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Validate workflow for export compatibility.
 * Checks for unsupported block types and providers.
 */
export function validateWorkflowForExport(state: WorkflowState | null | undefined): ValidationResult {
  const unsupportedBlocks: Array<{ id: string; name: string; type: string }> = []
  const unsupportedProviders: Array<{ id: string; name: string; model: string; provider: string }> =
    []

  const blocks = state?.blocks ?? {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const blockType = block.type

    // Check if block type is supported
    if (!SUPPORTED_BLOCK_TYPES.has(blockType)) {
      unsupportedBlocks.push({
        id: blockId,
        name: block.name ?? blockId,
        type: blockType,
      })
    }

    // For agent blocks, check if the provider is supported
    if (blockType === 'agent') {
      const model = block.subBlocks?.model?.value ?? block.inputs?.model ?? ''
      const provider = detectProviderFromModel(model)

      if (!SUPPORTED_PROVIDERS.has(provider)) {
        unsupportedProviders.push({
          id: blockId,
          name: block.name ?? blockId,
          model: model,
          provider: provider,
        })
      }
    }
  }

  const valid = unsupportedBlocks.length === 0 && unsupportedProviders.length === 0

  let message = ''
  if (!valid) {
    const parts: string[] = []
    if (unsupportedBlocks.length > 0) {
      const types = [...new Set(unsupportedBlocks.map((b) => b.type))]
      parts.push(`Unsupported block types: ${types.join(', ')}`)
    }
    if (unsupportedProviders.length > 0) {
      const providers = [...new Set(unsupportedProviders.map((p) => p.provider))]
      parts.push(
        `Unsupported providers: ${providers.join(', ')}. Supported: Anthropic (Claude), OpenAI (GPT), Google (Gemini)`
      )
    }
    message = parts.join('. ')
  }

  return { valid, unsupportedBlocks, unsupportedProviders, message }
}
