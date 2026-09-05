/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import * as learningTools from '@/tools/oracle_fusion_learning'
import { isInternalToolConfig } from '@/tools/types'

describe('Oracle Fusion Learning tool credential declarations', () => {
  it('binds all 40 internal operations to the existing Fusion service-account credential', () => {
    const tools = Object.values(learningTools)
    expect(tools).toHaveLength(40)
    for (const tool of tools) {
      expect(isInternalToolConfig(tool)).toBe(true)
      expect(tool.oauth).toEqual({
        required: true, provider: 'oracle_fusion_learning', requiredScopes: [],
        credentialKind: 'service-account', authoritativeParams: ['instanceUrl'],
      })
      expect(tool.params.oauthCredential).toMatchObject({ required: true, visibility: 'user-only' })
      expect(tool.params.instanceUrl).toMatchObject({ required: false, visibility: 'hidden' })
      expect(tool.params.accessToken).toMatchObject({ required: false, visibility: 'hidden' })
      expect(tool).not.toHaveProperty('request')
    }
  })

  it('removes executor scope while retaining semantic fields for the internal boundary', () => {
    const input = { oauthCredential: 'credential-id', personId: '1', body: { learningItemId: '2' }, _context: { workspaceId: 'private-workspace' } }
    const result = learningTools.oracleFusionLearningCreateLearningRecordTool.operation.input(input)
    expect(result).toEqual({ oauthCredential: 'credential-id', personId: '1', body: { learningItemId: '2' } })
    expect(input).toHaveProperty('_context')
  })
})
