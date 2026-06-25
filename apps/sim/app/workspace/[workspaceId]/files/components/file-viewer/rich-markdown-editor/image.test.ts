/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  createPublicFileContentSource,
  createWorkspaceFileContentSource,
} from '@/hooks/use-file-content-source'

const KEY = 'workspace/W1/1700000000000-deadbeefdeadbeef-photo.png'
const ENCODED = encodeURIComponent(KEY)

describe('content-source resolveImageSrc', () => {
  it('in-app source rewrites embeds to the workspace-scoped inline route', () => {
    const src = createWorkspaceFileContentSource('ws-1')
    expect(src.resolveImageSrc(`/api/files/serve/${ENCODED}?context=workspace`)).toBe(
      `/api/workspaces/ws-1/files/inline?key=${encodeURIComponent(KEY)}`
    )
    expect(src.resolveImageSrc('/api/files/view/wf_abc')).toBe(
      '/api/workspaces/ws-1/files/inline?fileId=wf_abc'
    )
  })

  it('public source rewrites embeds to the token-scoped inline route', () => {
    const src = createPublicFileContentSource('tok_1', '/api/files/public/tok_1/content')
    expect(src.resolveImageSrc('/api/files/view/wf_abc')).toBe(
      '/api/files/public/tok_1/inline?fileId=wf_abc'
    )
  })

  it('passes external/data srcs through unchanged in both sources', () => {
    const ws = createWorkspaceFileContentSource('ws-1')
    const pub = createPublicFileContentSource('tok_1', '/c')
    expect(ws.resolveImageSrc('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png'
    )
    expect(pub.resolveImageSrc('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png'
    )
    expect(ws.resolveImageSrc(undefined)).toBeUndefined()
  })
})
