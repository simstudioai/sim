import type { ToolConfig } from '@/tools/types'

/**
 * The Hex host most workspaces use. EU multi-tenant, HIPAA multi-tenant, and single-tenant
 * workspaces call the API on their own hex.tech host instead (`eu.hex.tech`, `acme.hex.tech`).
 * See https://learn.hex.tech/docs/api/api-overview
 */
export const DEFAULT_HEX_HOST = 'app.hex.tech'

/**
 * One DNS label under hex.tech, the shape of every workspace host Hex documents. The pattern alone
 * cannot tell a workspace from Hex's other sites, some of which third parties serve (the status
 * page, the docs site), so those known non-workspace labels are refused by name.
 */
export const HEX_HOST_PATTERN =
  /^(?!(?:www|docs|learn|status|help|community|blog)\.)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.hex\.tech$/i

/**
 * Reduces a typed Hex workspace address (`https://eu.hex.tech/`, `Acme.hex.tech`) to its host,
 * refusing anything but a single label under hex.tech.
 */
export function normalizeHexHost(raw: string | undefined): string {
  const host = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '')
  if (!HEX_HOST_PATTERN.test(host)) throw new Error('Hex host must be a hex.tech host')
  return host
}

/**
 * The API base of a Hex host. Absent means app.hex.tech, so tools run without a saved credential
 * keep their host; anything outside hex.tech is refused.
 */
export function hexApiBase(host?: string): string {
  if (host !== undefined && !HEX_HOST_PATTERN.test(host))
    throw new Error('Hex host must be a hex.tech host')
  return `https://${host ?? DEFAULT_HEX_HOST}/api/v1`
}

/** The hex.tech host a saved Hex token was verified on; only the credential fills it. */
export const HEX_HOST_PARAM = {
  type: 'string',
  required: false,
  visibility: 'hidden',
  description: 'Hex workspace host of the selected credential (app.hex.tech by default)',
} as const satisfies ToolConfig['params'][string]
