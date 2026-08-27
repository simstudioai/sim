/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { downloadArtifactTool, downloadArtifactV2Tool } from '@/tools/cursor/download_artifact'

describe('Cursor artifact operation declarations', () => {
  it.each([downloadArtifactTool, downloadArtifactV2Tool])(
    'declares $id without HTTP-shaped metadata',
    (tool) => {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  )
})
