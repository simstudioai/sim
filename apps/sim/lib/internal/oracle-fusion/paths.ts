const API_VERSION = '11.13.18.05'
const API_ROOTS = {
  hcm: `/hcmRestApi/resources/${API_VERSION}`,
  fscm: `/fscmRestApi/resources/${API_VERSION}`,
  crm: `/crmRestApi/resources/${API_VERSION}`,
} as const
const ABSOLUTE_PATH = /^[a-z][a-z0-9+.-]*:/i
const UNSAFE_PATH_ENCODING = /%(?:2e|2f|5c|3f|23)/i
const PATH_CONTROL = /[\u0000-\u001f\u007f]/
const PATH_WHITESPACE = /\s/

export type OracleFusionApiFamily = keyof typeof API_ROOTS

export interface OracleFusionResourceAddress {
  family: OracleFusionApiFamily
  relativePath: string
}

function validateRelativePath(relativePath: string): void {
  if (
    !relativePath ||
    relativePath !== relativePath.trim() ||
    relativePath.startsWith('/') ||
    ABSOLUTE_PATH.test(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.includes('?') ||
    relativePath.includes('#') ||
    PATH_CONTROL.test(relativePath) ||
    PATH_WHITESPACE.test(relativePath) ||
    UNSAFE_PATH_ENCODING.test(relativePath)
  ) {
    throw new Error('Oracle Fusion resource path must be a safe relative path')
  }

  for (const segment of relativePath.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error('Oracle Fusion resource path must not contain empty or traversal segments')
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
      void encodeURIComponent(decoded)
    } catch {
      throw new Error('Oracle Fusion resource path contains invalid URL encoding')
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('?') ||
      decoded.includes('#') ||
      PATH_CONTROL.test(decoded)
    ) {
      throw new Error('Oracle Fusion resource path must be a safe relative path')
    }
  }
}

/** Builds one canonical path beneath a fixed Oracle Fusion product API root. */
export function buildOracleFusionResourcePath(address: OracleFusionResourceAddress): string {
  validateRelativePath(address.relativePath)
  const root = API_ROOTS[address.family]
  if (!root) throw new Error('Oracle Fusion API family is unsupported')
  return `${root}/${address.relativePath}`
}
