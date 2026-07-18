import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, inArray } from 'drizzle-orm'
import type {
  CredentialBindingResult,
  CredentialSelectionRequest,
  RequiredOAuthBinding,
} from '@/lib/apps/credential-binding-types'
import type { AccessibleOAuthCredential } from '@/lib/credentials/environment'
import { getAccessibleOAuthCredentials } from '@/lib/credentials/environment'
import { getMissingRequiredScopes, getProviderIdFromServiceId } from '@/lib/oauth/utils'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { getBlock } from '@/blocks'

const logger = createLogger('FullstackDemoCredentialBinding')

export type {
  CredentialBindingResult,
  CredentialChoice,
  CredentialSelectionRequest,
  RequiredOAuthBinding,
} from '@/lib/apps/credential-binding-types'

function bindingKey(
  binding: Pick<RequiredOAuthBinding, 'workflowId' | 'blockId' | 'subBlockId'>
): string {
  return `${binding.workflowId}:${binding.blockId}:${binding.subBlockId}`
}

function readSubBlockValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
  }
  return null
}

/**
 * Discover required oauth-input subblocks across saved workflow drafts.
 */
export async function discoverRequiredOAuthBindings(
  workflowIds: string[]
): Promise<RequiredOAuthBinding[]> {
  const bindings: RequiredOAuthBinding[] = []

  for (const workflowId of workflowIds) {
    const draft = await loadWorkflowFromNormalizedTables(workflowId)
    if (!draft) continue

    for (const [blockId, block] of Object.entries(draft.blocks || {})) {
      const blockType = block.type
      if (!blockType) continue
      const config = getBlock(blockType)
      if (!config?.subBlocks?.length) continue

      for (const sub of config.subBlocks) {
        if (sub.type !== 'oauth-input') continue
        if (sub.required === false) continue
        if (sub.mode === 'advanced') continue
        const serviceId = typeof sub.serviceId === 'string' ? sub.serviceId : ''
        if (!serviceId) continue

        const providerId = getProviderIdFromServiceId(serviceId)
        const currentValue = readSubBlockValue(block.subBlocks?.[sub.id])
        bindings.push({
          workflowId,
          blockId,
          blockType,
          subBlockId: sub.id,
          serviceId,
          providerId,
          requiredScopes: Array.isArray(sub.requiredScopes) ? [...sub.requiredScopes] : [],
          currentValue,
        })
      }
    }
  }

  return bindings
}

async function loadCredentialScopes(credentialIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (credentialIds.length === 0) return out

  const rows = await db
    .select({
      id: credential.id,
      scope: account.scope,
    })
    .from(credential)
    .leftJoin(account, eq(credential.accountId, account.id))
    .where(inArray(credential.id, credentialIds))

  for (const row of rows) {
    const scopes = (row.scope || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    out.set(row.id, scopes)
  }
  return out
}

function matchesProvider(
  credentialRow: AccessibleOAuthCredential,
  providerId: string,
  serviceId: string
): boolean {
  if (credentialRow.providerId === providerId) return true
  // Some rows store the service key instead of the OAuth providerId.
  if (credentialRow.providerId === serviceId) return true
  return false
}

function filterMatchingCredentials(
  accessible: AccessibleOAuthCredential[],
  binding: RequiredOAuthBinding,
  scopesById: Map<string, string[]>
): AccessibleOAuthCredential[] {
  return accessible.filter((cred) => {
    if (!matchesProvider(cred, binding.providerId, binding.serviceId)) return false
    if (binding.requiredScopes.length === 0) return true
    const scopes = scopesById.get(cred.id) || []
    // Empty stored scopes are treated as unknown (legacy); allow when access already validated.
    if (scopes.length === 0) return true
    return getMissingRequiredScopes({ scopes }, binding.requiredScopes).length === 0
  })
}

export async function patchWorkflowCredentialBindings(
  patches: Array<{
    workflowId: string
    blockId: string
    subBlockId: string
    credentialId: string
  }>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const byWorkflow = new Map<string, typeof patches>()
  for (const patch of patches) {
    const list = byWorkflow.get(patch.workflowId) || []
    list.push(patch)
    byWorkflow.set(patch.workflowId, list)
  }

  for (const [workflowId, workflowPatches] of byWorkflow) {
    const draft = await loadWorkflowFromNormalizedTables(workflowId)
    if (!draft) {
      return { ok: false, error: `Workflow draft missing: ${workflowId}` }
    }

    for (const patch of workflowPatches) {
      const block = draft.blocks[patch.blockId]
      if (!block) {
        return { ok: false, error: `Block ${patch.blockId} missing in ${workflowId}` }
      }
      const subBlocks = { ...(block.subBlocks || {}) }
      subBlocks[patch.subBlockId] = {
        id: patch.subBlockId,
        type: 'oauth-input',
        value: patch.credentialId,
      }
      draft.blocks[patch.blockId] = { ...block, subBlocks }
    }

    const saved = await saveWorkflowToNormalizedTables(workflowId, {
      blocks: draft.blocks,
      edges: draft.edges || [],
      loops: draft.loops || {},
      parallels: draft.parallels || {},
      lastSaved: Date.now(),
    })
    if (!saved.success) {
      return {
        ok: false,
        error: saved.error || `Failed to save credential bindings for ${workflowId}`,
      }
    }
  }

  return { ok: true }
}

/**
 * Auto-bind when exactly one matching credential exists.
 * Ask the creator when multiple match. Fail when none match.
 */
export async function resolveAndBindOAuthCredentials(params: {
  userId: string
  workspaceId: string
  workflowIds: string[]
  /** Creator selections keyed by `${workflowId}:${blockId}:${subBlockId}`. */
  selections?: Record<string, string>
}): Promise<CredentialBindingResult> {
  const bindings = await discoverRequiredOAuthBindings(params.workflowIds)
  if (bindings.length === 0) {
    return { ok: true, boundCount: 0 }
  }

  const accessible = await getAccessibleOAuthCredentials(params.workspaceId, params.userId)
  const scopesById = await loadCredentialScopes(accessible.map((c) => c.id))
  const selections = params.selections || {}

  const patches: Array<{
    workflowId: string
    blockId: string
    subBlockId: string
    credentialId: string
  }> = []
  const needsSelection: CredentialSelectionRequest[] = []
  const missing: RequiredOAuthBinding[] = []

  for (const binding of bindings) {
    if (binding.currentValue) {
      const stillAccessible = accessible.some((c) => c.id === binding.currentValue)
      if (stillAccessible) continue
    }

    const matches = filterMatchingCredentials(accessible, binding, scopesById)
    const key = bindingKey(binding)
    const selectedId = selections[key]

    if (selectedId) {
      const selected = matches.find((c) => c.id === selectedId)
      if (!selected) {
        return {
          ok: false,
          code: 'INVALID_SELECTION',
          error: `Selected credential is not valid for ${binding.serviceId}`,
        }
      }
      patches.push({
        workflowId: binding.workflowId,
        blockId: binding.blockId,
        subBlockId: binding.subBlockId,
        credentialId: selected.id,
      })
      continue
    }

    if (matches.length === 1) {
      patches.push({
        workflowId: binding.workflowId,
        blockId: binding.blockId,
        subBlockId: binding.subBlockId,
        credentialId: matches[0]!.id,
      })
      continue
    }

    if (matches.length === 0) {
      missing.push(binding)
      continue
    }

    needsSelection.push({
      bindingKey: key,
      workflowId: binding.workflowId,
      blockId: binding.blockId,
      subBlockId: binding.subBlockId,
      serviceId: binding.serviceId,
      providerId: binding.providerId,
      choices: matches.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        providerId: c.providerId,
      })),
    })
  }

  if (missing.length > 0) {
    const services = [...new Set(missing.map((m) => m.serviceId))].join(', ')
    return {
      ok: false,
      code: 'CONNECT_REQUIRED',
      error: `Connect a ${services} account in this workspace, then retry.`,
    }
  }

  if (needsSelection.length > 0) {
    return {
      ok: false,
      code: 'SELECTION_REQUIRED',
      error: 'Select which connected account to use for each integration.',
      selections: needsSelection,
    }
  }

  if (patches.length > 0) {
    const patched = await patchWorkflowCredentialBindings(patches)
    if (!patched.ok) {
      logger.warn('Failed to patch credential bindings', { error: patched.error })
      return { ok: false, code: 'BIND_FAILED', error: patched.error }
    }
  }

  return { ok: true, boundCount: patches.length }
}
