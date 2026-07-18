import { getBlock } from '@/blocks'

function readCredentialValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
  }
  return null
}

/** Reject public API start fields that look like credential/secret inputs. */
export function isCredentialLikeFieldName(name: string): boolean {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (!normalized) return false
  return (
    normalized.includes('credential') ||
    normalized.includes('oauth') ||
    normalized.includes('accesstoken') ||
    normalized.includes('refreshtoken') ||
    normalized.includes('apitoken') ||
    normalized.includes('apikey') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized === 'token' ||
    normalized.endsWith('token')
  )
}

/**
 * Ensure every required oauth-input is bound and no credential-like API start
 * fields are exposed on the public App surface.
 */
export function assertPrivateCredentialBoundary(params: {
  workflowId: string
  blocks: Record<
    string,
    {
      id?: string
      type: string
      subBlocks?: Record<string, unknown>
    }
  >
  apiStartFieldNames: string[]
}): { ok: true } | { ok: false; error: string; code: string } {
  for (const name of params.apiStartFieldNames) {
    if (isCredentialLikeFieldName(name)) {
      return {
        ok: false,
        error: `API start field "${name}" looks like a credential and cannot be exposed on Apps`,
        code: 'CREDENTIAL_FIELD_EXPOSED',
      }
    }
  }

  for (const [blockId, block] of Object.entries(params.blocks || {})) {
    const config = getBlock(block.type)
    if (!config?.subBlocks?.length) continue
    for (const sub of config.subBlocks) {
      if (sub.type !== 'oauth-input') continue
      if (sub.required === false) continue
      if (sub.mode === 'advanced') continue
      const value = readCredentialValue(block.subBlocks?.[sub.id])
      if (!value) {
        const serviceId = typeof sub.serviceId === 'string' ? sub.serviceId : 'OAuth'
        return {
          ok: false,
          error: `Workflow requires a bound ${serviceId} credential on block ${blockId} before Apps handoff`,
          code: 'OAUTH_UNBOUND',
        }
      }
    }
  }

  return { ok: true }
}
