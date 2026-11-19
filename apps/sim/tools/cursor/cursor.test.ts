import { describe, expect, it } from 'vitest'
import { deleteAgentV2Tool } from '@/tools/cursor/delete_agent'
import { listArtifactsTool, listArtifactsV2Tool } from '@/tools/cursor/list_artifacts'

const artifactsResponse = () =>
  new Response(
    JSON.stringify({
      artifacts: [
        {
          absolutePath: '/opt/cursor/artifacts/screenshot.png',
          sizeBytes: 12345,
          updatedAt: '2024-01-15T11:02:00.000Z',
        },
      ],
    })
  )

const expectedArtifact = {
  absolutePath: '/opt/cursor/artifacts/screenshot.png',
  sizeBytes: 12345,
  updatedAt: '2024-01-15T11:02:00.000Z',
  path: '/opt/cursor/artifacts/screenshot.png',
  size: 12345,
}

describe('cursor list artifacts', () => {
  it('fills path and size from the absolutePath and sizeBytes Cursor returns', async () => {
    const v2 = await listArtifactsV2Tool.transformResponse?.(artifactsResponse())
    expect(v2?.output.artifacts).toEqual([expectedArtifact])

    const v1 = await listArtifactsTool.transformResponse?.(artifactsResponse())
    expect(v1?.output.metadata.artifacts).toEqual([expectedArtifact])
  })
})

describe('cursor agent path segments', () => {
  const deleteUrl = (agentId: string) => {
    const url = deleteAgentV2Tool.request.url
    if (typeof url !== 'function') throw new Error('expected a url builder')
    return url({ apiKey: 'k', agentId })
  }

  it.each(['..', '.', 'bc_1/../me'])(
    'rejects agent id %j before a DELETE can leave the agent route',
    (id) => {
      expect(() => deleteUrl(id)).toThrow(/agentId/)
    }
  )

  it('leaves ordinary ids unchanged', () => {
    expect(deleteUrl(' bc_abc123 ')).toBe('https://api.cursor.com/v0/agents/bc_abc123')
  })
})
