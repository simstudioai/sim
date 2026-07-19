/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { shareSource, workspaceSource } from '@/resources'
import { fileImageSrc } from '@/resources/file-source'

const KEY = 'workspace/W1/1700000000000-deadbeefdeadbeef-photo.png'
const ENCODED = encodeURIComponent(KEY)

const WORKSPACE = workspaceSource({ kind: 'file', workspaceId: 'ws-1', resourceId: 'file-1' })
const SHARE = shareSource({
  kind: 'file',
  token: 'tok_1',
  grantId: 'tok_1',
  seed: { name: 'photo.png', type: 'image/png', size: 1, version: 1 },
})

describe('fileImageSrc', () => {
  it('rewrites workspace embeds to the workspace-scoped inline route', () => {
    expect(fileImageSrc(WORKSPACE, `/api/files/serve/${ENCODED}?context=workspace`)).toBe(
      `/api/workspaces/ws-1/files/inline?key=${encodeURIComponent(KEY)}`
    )
    expect(fileImageSrc(WORKSPACE, '/api/files/view/wf_abc')).toBe(
      '/api/workspaces/ws-1/files/inline?fileId=wf_abc'
    )
  })

  it('rewrites share embeds to the token-scoped inline route', () => {
    expect(fileImageSrc(SHARE, '/api/files/view/wf_abc')).toBe(
      '/api/files/public/tok_1/inline?fileId=wf_abc'
    )
  })

  it('rewrites an interface module share to the module-scoped inline route', () => {
    const moduleShare = shareSource({
      kind: 'file',
      token: 'tok_1',
      grantId: 'mod_9',
      seed: { name: 'photo.png', type: 'image/png', size: 1, version: 1 },
    })
    expect(fileImageSrc(moduleShare, '/api/files/view/wf_abc')).toBe(
      '/api/interfaces/public/tok_1/modules/mod_9/file/inline?fileId=wf_abc'
    )
  })

  it('passes external/data srcs through unchanged in both scopes', () => {
    expect(fileImageSrc(WORKSPACE, 'https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png'
    )
    expect(fileImageSrc(SHARE, 'https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png'
    )
    expect(fileImageSrc(WORKSPACE, undefined)).toBeUndefined()
  })
})
