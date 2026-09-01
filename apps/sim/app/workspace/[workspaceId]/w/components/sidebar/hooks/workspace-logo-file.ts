const MAX_WORKSPACE_LOGO_SIZE = 5 * 1024 * 1024

const WORKSPACE_LOGO_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
] as const

const WORKSPACE_LOGO_IMAGE_TYPE_SET = new Set<string>(WORKSPACE_LOGO_IMAGE_TYPES)

export const WORKSPACE_LOGO_ACCEPT_ATTRIBUTE = WORKSPACE_LOGO_IMAGE_TYPES.join(',')

export function validateWorkspaceLogoFile(
  file: Pick<File, 'name' | 'size' | 'type'>
): string | null {
  if (file.size > MAX_WORKSPACE_LOGO_SIZE) {
    return `File "${file.name}" is too large. Maximum size is 5MB.`
  }
  if (!WORKSPACE_LOGO_IMAGE_TYPE_SET.has(file.type)) {
    return `File "${file.name}" is not a supported image format. Please use PNG, JPEG, GIF, SVG, or WebP.`
  }
  return null
}
