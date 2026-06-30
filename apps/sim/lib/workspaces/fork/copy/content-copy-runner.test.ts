/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { serializeContentRefMaps } from '@/lib/workspaces/fork/copy/content-copy-runner'

describe('serializeContentRefMaps', () => {
  it('converts each map to a record and drops empty maps', () => {
    const result = serializeContentRefMaps({
      workspaceId: { from: 'src', to: 'dst' },
      fileKeys: new Map([['k1', 'k2']]),
      fileIds: new Map(),
      workflows: new Map([['wf-src', 'wf-dst']]),
      knowledgeBases: new Map([['kb-src', 'kb-dst']]),
      skills: new Map([['sk-src', 'sk-dst']]),
    })

    expect(result.workspaceId).toEqual({ from: 'src', to: 'dst' })
    expect(result.fileKeys).toEqual({ k1: 'k2' })
    // An empty map is omitted rather than serialized to `{}`.
    expect(result.fileIds).toBeUndefined()
    expect(result.workflows).toEqual({ 'wf-src': 'wf-dst' })
    expect(result.knowledgeBases).toEqual({ 'kb-src': 'kb-dst' })
    expect(result.skills).toEqual({ 'sk-src': 'sk-dst' })
    // Maps not supplied stay undefined.
    expect(result.tables).toBeUndefined()
    expect(result.folders).toBeUndefined()
  })

  it('passes an undefined workspaceId through unchanged', () => {
    const result = serializeContentRefMaps({})
    expect(result.workspaceId).toBeUndefined()
    expect(result.fileKeys).toBeUndefined()
    expect(result.skills).toBeUndefined()
  })
})
