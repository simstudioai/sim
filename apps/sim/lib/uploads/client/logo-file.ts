const MAX_LOGO_SIZE = 5 * 1024 * 1024

const LOGO_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
] as const

const LOGO_IMAGE_TYPE_SET = new Set<string>(LOGO_IMAGE_TYPES)

export const LOGO_ACCEPT_ATTRIBUTE = LOGO_IMAGE_TYPES.join(',')

export function validateLogoFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size > MAX_LOGO_SIZE) {
    return `File "${file.name}" is too large. Maximum size is 5MB.`
  }
  if (!LOGO_IMAGE_TYPE_SET.has(file.type)) {
    return `File "${file.name}" is not a supported image format. Please use PNG, JPEG, GIF, SVG, or WebP.`
  }
  return null
}
