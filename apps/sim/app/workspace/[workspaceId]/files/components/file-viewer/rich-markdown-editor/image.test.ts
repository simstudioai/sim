import { describe, expect, it } from 'vitest'
import {
  createPublicFileContentSource,
  createWorkspaceFileContentSource,
} from '@/hooks/use-file-content-source'

describe('content-source resolveImageSrc', () => {
  it('public source rewrites embeds to the token-scoped inline route', () => {
    const src = createPublicFileContentSource('tok_1', '/api/files/public/tok_1/content')
    expect(src.resolveImageSrc('/api/files/view/wf_abc')).toBe(
      '/api/files/public/tok_1/inline?fileId=wf_abc'
    )
  })

  it('normalizes a percent-encoded id before building an inline request', () => {
    const workspace = createWorkspaceFileContentSource('ws-1')
    const publicShare = createPublicFileContentSource('tok_1', '/api/files/public/tok_1/content')

    expect(workspace.resolveImageSrc('/api/files/view/wf%5Fabc')).toBe(
      '/api/workspaces/ws-1/files/inline?fileId=wf_abc'
    )
    expect(publicShare.resolveImageSrc('/api/files/view/wf%5Fabc')).toBe(
      '/api/files/public/tok_1/inline?fileId=wf_abc'
    )
  })
})
