/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileAppendTool } from '@/tools/file/append'
import { fileWriteTool } from '@/tools/file/write'

describe('workspace file mutation provenance', () => {
  it.each([
    ['write', fileWriteTool],
    ['append', fileAppendTool],
  ])('delegates only %s content provenance to the authenticated file route', (_name, tool) => {
    const modelInput = tool.request.modelInput
    expect(modelInput?.mode).toBe('private-provenance')
    if (modelInput?.mode !== 'private-provenance') throw new Error('Unexpected model input mode')

    expect(
      modelInput.select({
        fileName: 'public-name.txt',
        content: 'causal-content',
        workspaceId: 'workspace-id',
      })
    ).toBe('causal-content')
  })
})
