import type { McpServerTestResult } from '@/platform/lib/data/workflow-editor/mcp'

/** One header row of the form; the last row is always an empty one waiting for input. */
export interface HeaderEntry {
  key: string
  value: string
}

/** A `{{SECRET}}` reference anywhere in a value. */
const ENV_VAR_PATTERN = /\{\{[^{}]+\}\}/

/** A reference in the URL's host means the destination is only known at run time. */
function hasEnvVarInHostname(url: string): boolean {
  const globalPattern = new RegExp(ENV_VAR_PATTERN.source, 'g')
  if (url.trim().replace(globalPattern, '').trim() === '') return true
  const protocolEnd = url.indexOf('://')
  if (protocolEnd === -1) return ENV_VAR_PATTERN.test(url)
  const afterProtocol = url.substring(protocolEnd + 3)
  const authorityEnd = afterProtocol.search(/[/?#]/)
  const authority = authorityEnd === -1 ? afterProtocol : afterProtocol.substring(0, authorityEnd)
  return ENV_VAR_PATTERN.test(authority)
}

/**
 * Whether the server's domain policy admits the URL. `null` means no policy; a host that is only
 * resolved at run time is checked by the server then, so it passes here.
 */
export function isDomainAllowed(url: string | undefined, allowedDomains: string[] | null): boolean {
  if (allowedDomains === null) return true
  if (!url) return false
  if (hasEnvVarInHostname(url)) return true
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return allowedDomains.includes(hostname)
  } catch {
    return false
  }
}

/** The named header rows as the record the API takes; a row without a name is dropped. */
export function headersToRecord(headers: HeaderEntry[] | undefined): Record<string, string> {
  const record: Record<string, string> = {}
  for (const header of headers || []) {
    if (header.key.trim()) {
      record[header.key] = header.value
    }
  }
  return record
}

function extractStringHeaders(headers: unknown): Record<string, string> {
  if (typeof headers !== 'object' || headers === null) return {}
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

/**
 * Updates one header cell, keeping one empty row last: typing into the last row adds another,
 * and an emptied row that is not last goes away.
 */
export function updateHeadersArray(
  headers: HeaderEntry[],
  index: number,
  field: 'key' | 'value',
  value: string
): HeaderEntry[] {
  const updated = [...headers]
  if (updated[index]) {
    updated[index] = { ...updated[index], [field]: value }
  }

  const lastIdx = updated.length - 1
  if (index === lastIdx && updated[lastIdx] && (updated[lastIdx].key || updated[lastIdx].value)) {
    updated.push({ key: '', value: '' })
  }

  const lastIndex = updated.length - 1
  return updated.filter((h, i) => i === lastIndex || h.key !== '' || h.value !== '')
}

/** The edit form's test action names the last result, so it doubles as the connection status. */
export function getTestButtonLabel(
  testResult: McpServerTestResult | null,
  isTestingConnection: boolean
): string {
  if (isTestingConnection) return 'Testing…'
  if (testResult?.success) return 'Connection success'
  if (testResult?.authRequired) return 'Requires OAuth'
  if (testResult && !testResult.success) return 'No connection: retry'
  return 'Test connection'
}

interface ParsedJsonConfig {
  config: { name: string; url: string; headers: Record<string, string> } | null
  /** A blocking error, or a warning beside a config that still imports. */
  message: string | null
}

/**
 * Reads a pasted `mcpServers` block (the first server only) or a bare `{ url, headers }` object,
 * the shapes other MCP clients export.
 */
export function parseJsonConfig(json: string): ParsedJsonConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { config: null, message: 'Invalid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { config: null, message: 'JSON must contain "mcpServers" or a "url" field' }
  }
  const root = parsed as Record<string, unknown>

  if (root.mcpServers && typeof root.mcpServers === 'object') {
    const entries = Object.entries(root.mcpServers as Record<string, unknown>)
    if (entries.length === 0) return { config: null, message: 'No servers found in mcpServers' }
    const [name, rawConfig] = entries[0]
    const config =
      rawConfig && typeof rawConfig === 'object' ? (rawConfig as Record<string, unknown>) : {}
    if (!config.url || typeof config.url !== 'string') {
      return { config: null, message: 'Server config must include a "url" field' }
    }
    return {
      config: { name, url: config.url, headers: extractStringHeaders(config.headers) },
      message:
        entries.length > 1
          ? `Only the first server ("${name}") will be imported. Paste each config separately to add others.`
          : null,
    }
  }

  if (root.url && typeof root.url === 'string') {
    return {
      config: { name: '', url: root.url, headers: extractStringHeaders(root.headers) },
      message: null,
    }
  }

  return { config: null, message: 'JSON must contain "mcpServers" or a "url" field' }
}
