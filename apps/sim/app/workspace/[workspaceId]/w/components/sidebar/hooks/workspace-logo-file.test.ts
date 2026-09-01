import { describe, expect, it } from 'vitest'
import {
  validateWorkspaceLogoFile,
  WORKSPACE_LOGO_ACCEPT_ATTRIBUTE,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/workspace-logo-file'

function file(overrides: Partial<Pick<File, 'name' | 'size' | 'type'>> = {}) {
  return {
    name: 'logo.png',
    size: 1024,
    type: 'image/png',
    ...overrides,
  }
}

describe('workspace logo files', () => {
  it('advertises and accepts GIF images', () => {
    expect(WORKSPACE_LOGO_ACCEPT_ATTRIBUTE.split(',')).toContain('image/gif')
    expect(validateWorkspaceLogoFile(file({ name: 'animated.gif', type: 'image/gif' }))).toBeNull()
  })

  it('rejects files larger than 5MB', () => {
    expect(validateWorkspaceLogoFile(file({ size: 5 * 1024 * 1024 + 1 }))).toBe(
      'File "logo.png" is too large. Maximum size is 5MB.'
    )
  })

  it('lists GIF among the supported formats in validation errors', () => {
    expect(validateWorkspaceLogoFile(file({ name: 'logo.bmp', type: 'image/bmp' }))).toBe(
      'File "logo.bmp" is not a supported image format. Please use PNG, JPEG, GIF, SVG, or WebP.'
    )
  })
})
