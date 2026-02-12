import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { hashWorkflowState, loadWorkflowStateFromDb } from './workflow-state'

const logger = createLogger('WorkflowVerifyServerTool')

const AcceptanceItemSchema = z.union([
  z.string(),
  z.object({
    kind: z.string().optional(),
    assert: z.string(),
  }),
])

const WorkflowVerifyInputSchema = z
  .object({
    workflowId: z.string(),
    acceptance: z.array(AcceptanceItemSchema).optional(),
    baseSnapshotHash: z.string().optional(),
  })
  .strict()

type WorkflowVerifyParams = z.infer<typeof WorkflowVerifyInputSchema>

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function canonicalizeToken(value: string): string {
  return normalizeName(value).replace(/[^a-z0-9]/g, '')
}

function resolveBlockToken(
  workflowState: { blocks: Record<string, any> },
  token: string
): string | null {
  if (!token) return null
  if (workflowState.blocks[token]) return token
  const normalized = normalizeName(token)
  const canonical = canonicalizeToken(token)
  for (const [blockId, block] of Object.entries(workflowState.blocks || {})) {
    const blockName = normalizeName(String((block as Record<string, unknown>).name || ''))
    if (blockName === normalized) return blockId
    if (canonicalizeToken(blockName) === canonical) return blockId
  }
  return null
}

function hasPath(
  workflowState: { edges: Array<Record<string, any>> },
  blockPath: string[]
): boolean {
  if (blockPath.length < 2) return true
  const adjacency = new Map<string, string[]>()
  for (const edge of workflowState.edges || []) {
    const source = String(edge.source || '')
    const target = String(edge.target || '')
    if (!source || !target) continue
    const existing = adjacency.get(source) || []
    existing.push(target)
    adjacency.set(source, existing)
  }

  for (let i = 0; i < blockPath.length - 1; i++) {
    const from = blockPath[i]
    const to = blockPath[i + 1]
    const next = adjacency.get(from) || []
    if (!next.includes(to)) return false
  }
  return true
}

function evaluateAssertions(params: {
  workflowState: {
    blocks: Record<string, any>
    edges: Array<Record<string, any>>
  }
  assertions: string[]
}): { failures: string[]; checks: Array<Record<string, any>> } {
  const failures: string[] = []
  const checks: Array<Record<string, any>> = []

  for (const assertion of params.assertions) {
    if (assertion.startsWith('block_exists:')) {
      const token = assertion.slice('block_exists:'.length).trim()
      const blockId = resolveBlockToken(params.workflowState, token)
      const passed = Boolean(blockId)
      checks.push({ assert: assertion, passed, resolvedBlockId: blockId || null })
      if (!passed) failures.push(`Assertion failed: ${assertion}`)
      continue
    }

    if (assertion.startsWith('trigger_exists:')) {
      const triggerType = normalizeName(assertion.slice('trigger_exists:'.length))
      const triggerBlock = Object.values(params.workflowState.blocks || {}).find((block: any) => {
        if (block?.triggerMode !== true) return false
        return normalizeName(String(block?.type || '')) === triggerType
      })
      const passed = Boolean(triggerBlock)
      checks.push({ assert: assertion, passed })
      if (!passed) failures.push(`Assertion failed: ${assertion}`)
      continue
    }

    if (assertion.startsWith('path_exists:')) {
      const rawPath = assertion.slice('path_exists:'.length).trim()
      const tokens = rawPath
        .split('->')
        .map((token) => token.trim())
        .filter(Boolean)
      const resolvedPath = tokens
        .map((token) => resolveBlockToken(params.workflowState, token))
        .filter((value): value is string => Boolean(value))

      const resolvedAll = resolvedPath.length === tokens.length
      const passed = resolvedAll && hasPath(params.workflowState, resolvedPath)
      checks.push({
        assert: assertion,
        passed,
        resolvedPath,
      })
      if (!passed) failures.push(`Assertion failed: ${assertion}`)
      continue
    }

    // Unknown assertion format - mark as warning failure for explicit visibility.
    checks.push({ assert: assertion, passed: false, reason: 'unknown_assertion_type' })
    failures.push(`Unknown assertion format: ${assertion}`)
  }

  return { failures, checks }
}

export const workflowVerifyServerTool: BaseServerTool<WorkflowVerifyParams, any> = {
  name: 'workflow_verify',
  inputSchema: WorkflowVerifyInputSchema,
  async execute(params: WorkflowVerifyParams, context?: { userId: string }): Promise<any> {
    if (!context?.userId) {
      throw new Error('Unauthorized workflow access')
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: params.workflowId,
      userId: context.userId,
      action: 'read',
    })
    if (!authorization.allowed) {
      throw new Error(authorization.message || 'Unauthorized workflow access')
    }

    const { workflowState } = await loadWorkflowStateFromDb(params.workflowId)
    const snapshotHash = hashWorkflowState(workflowState as unknown as Record<string, unknown>)
    if (params.baseSnapshotHash && params.baseSnapshotHash !== snapshotHash) {
      return {
        success: false,
        verified: false,
        reason: 'snapshot_mismatch',
        expected: params.baseSnapshotHash,
        current: snapshotHash,
      }
    }

    const validation = validateWorkflowState(workflowState as any, { sanitize: false })

    const assertions = (params.acceptance || []).map((item) =>
      typeof item === 'string' ? item : item.assert
    )
    const assertionResults = evaluateAssertions({
      workflowState,
      assertions,
    })

    const verified =
      validation.valid && assertionResults.failures.length === 0 && validation.errors.length === 0

    logger.info('Workflow verification complete', {
      workflowId: params.workflowId,
      verified,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      assertionFailures: assertionResults.failures.length,
    })

    return {
      success: true,
      verified,
      snapshotHash,
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      assertions: assertionResults.checks,
      failures: assertionResults.failures,
    }
  },
}
