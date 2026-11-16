import { describe, expect, it } from 'vitest'
import { LangsmithBlock } from '@/blocks/blocks/langsmith'

const buildParams = LangsmithBlock.tools.config?.params
if (!buildParams) throw new Error('LangsmithBlock has no params mapper')

describe('LangsmithBlock', () => {
  /**
   * The model names the create-run outputs after the tool's `run_outputs` param, not the
   * block's `outputs` field; the mapper must not overwrite them with the empty field.
   */
  it('keeps model run outputs on an agent create-run call', () => {
    const args = { apiKey: 'key', name: 'run', run_type: 'chain', run_outputs: { answer: 42 } }

    expect(
      { ...args, ...buildParams(args, { operation: 'langsmith_create_run' }) }.run_outputs
    ).toEqual({ answer: 42 })
  })
})
