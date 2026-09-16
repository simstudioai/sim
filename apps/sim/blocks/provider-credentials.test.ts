/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { getProviderCredentialSubBlocks } from '@/blocks/utils'

describe('provider credential visibility', () => {
  const subBlocks = getProviderCredentialSubBlocks().filter(({ id }) => id !== 'apiKey')

  it.each([
    ['azure/MyDeployment', ['azureEndpoint', 'azureApiVersion']],
    ['AZURE/MyDeployment', ['azureEndpoint', 'azureApiVersion']],
    ['azure-anthropic/MyDeployment', ['azureEndpoint', 'azureApiVersion']],
    ['bedrock/custom-profile', ['bedrockAccessKeyId', 'bedrockSecretKey', 'bedrockRegion']],
    [
      'vertex/publishers/google/models/custom-gemini',
      ['vertexCredential', 'vertexManualCredential', 'vertexProject', 'vertexLocation'],
    ],
    [
      'VERTEX/CustomModel',
      ['vertexCredential', 'vertexManualCredential', 'vertexProject', 'vertexLocation'],
    ],
    ['gpt-4o', []],
    ['unknown/model', []],
    ['', []],
  ])('shows only the routed provider credentials for %s', (model, expected) => {
    const visible = subBlocks
      .filter((subBlock) => evaluateSubBlockCondition(subBlock.condition, { model }))
      .map(({ id }) => id)

    expect(visible).toEqual(expected)
  })
})
