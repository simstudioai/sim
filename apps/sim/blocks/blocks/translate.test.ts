import { describe, expect, it } from 'vitest'
import { TranslateBlock } from '@/blocks/blocks/translate'

const toolParams = (params: Record<string, unknown>) => {
  const build = TranslateBlock.tools.config?.params
  if (!build) throw new Error('TranslateBlock.tools.config.params is missing')
  return build({ context: 'Hello', targetLanguage: 'French', ...params })
}

describe('Translate Bedrock credential', () => {
  it('sends the saved AWS credential with a Bedrock model call', () => {
    expect(
      toolParams({
        model: 'bedrock/my-inference-profile',
        bedrockAuthMode: 'credential',
        bedrockCredential: 'aws-cred',
      })
    ).toMatchObject({ model: 'bedrock/my-inference-profile', bedrockCredential: 'aws-cred' })
  })

  it('refuses a Bedrock model call set to a saved AWS credential with none selected', () => {
    expect(() =>
      toolParams({
        model: 'bedrock/my-inference-profile',
        bedrockAuthMode: 'credential',
        bedrockCredential: '',
      })
    ).toThrow('Select an AWS credential for Bedrock')
  })

  it('ignores a leftover Bedrock credential choice once the model is not on Bedrock', () => {
    const params = toolParams({ model: 'gpt-4o', bedrockAuthMode: 'credential' })

    expect(params).toMatchObject({ model: 'gpt-4o' })
    expect(params.bedrockCredential).toBeUndefined()
  })
})
