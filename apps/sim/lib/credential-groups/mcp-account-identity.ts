import { isRecordLike, toRecord } from '@sim/utils/object'
import { isValidEmailSyntax } from '@sim/utils/string'
import type { McpToolResult } from '@/lib/mcp/types'

export interface ManagedMcpAccountIdentity {
  subject: string
  tenant: string | null
  label: string
}

/** An address only counts in text when a label names it as the signed-in account. */
const LABELED_EMAIL_IN_TEXT =
  /(?:e-?mail|signed in as|logged in as)[\s*`"':=]*([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+)/gi

function responseText(result: McpToolResult) {
  return (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
}

function responsePayload(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent
  try {
    return JSON.parse(responseText(result))
  } catch {
    return undefined
  }
}

function stringOrNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function emailFrom(result: McpToolResult, payload: unknown): string | null {
  const queue: unknown[] = [payload]
  for (let depth = 0; depth < 3; depth += 1) {
    const value = queue[depth]
    if (!isRecordLike(value)) continue
    if (typeof value.email === 'string' && isValidEmailSyntax(value.email.trim()))
      return value.email.trim().toLowerCase()
    queue.push(value.user ?? value.result ?? value.data)
  }
  if (payload !== undefined) return null
  const found = new Set(
    [...responseText(result).matchAll(LABELED_EMAIL_IN_TEXT)]
      .map((match) => (match[1] ?? '').toLowerCase())
      .filter((email) => isValidEmailSyntax(email))
  )
  return found.size === 1 ? ([...found][0] ?? null) : null
}

/**
 * Reads the signed-in account from the connector's identity tool. Response shapes come from each
 * vendor's documentation, so anything unexpected yields `null`, never a guessed identity: an
 * unidentified connection keeps working but cannot have another account added beside it.
 */
export function readManagedMcpAccountIdentity(
  connectorId: string,
  result: McpToolResult
): ManagedMcpAccountIdentity | null {
  if (result.isError) return null
  const payload = responsePayload(result)
  switch (connectorId) {
    case 'notion': {
      const record = toRecord(payload)
      const user = toRecord(record.user)
      const workspace = toRecord(record.workspace)
      const subject = stringOrNumber(user.id)
      const tenant = stringOrNumber(workspace.id)
      if (!subject || !tenant) return null
      const person = stringOrNumber(user.email) ?? stringOrNumber(user.name)
      const workspaceName = stringOrNumber(workspace.name)
      return {
        subject,
        tenant,
        label:
          person && workspaceName
            ? `${person} · ${workspaceName}`
            : (person ?? workspaceName ?? subject),
      }
    }
    case 'hubspot': {
      const record = toRecord(payload)
      const tenant = stringOrNumber(record.accountId)
      if (!tenant) return null
      return {
        subject: stringOrNumber(record.userId) ?? tenant,
        tenant,
        label: `HubSpot account ${tenant}`,
      }
    }
    case 'granola':
    case 'fireflies':
    case 'coda': {
      const email = emailFrom(result, payload)
      return email ? { subject: email, tenant: null, label: email } : null
    }
    default:
      return null
  }
}
