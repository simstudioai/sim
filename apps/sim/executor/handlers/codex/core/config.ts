/** Run-frozen loading and resolution for layered Codex configuration. */

import { db } from '@sim/db'
import { workflow, workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import {
  type CodexConfigPatch,
  type CodexConfigResolution,
  parseCodexConfigPatch,
  parseCodexWorkflowConfig,
  resolveCodexConfig,
} from '@/lib/codex/config'
import type { ExecutionContext } from '@/executor/types'

interface FrozenCodexLayers {
  workspace: CodexConfigPatch
  workflow: ReturnType<typeof parseCodexWorkflowConfig>
}

interface ResolveExecutionCodexConfigOptions {
  agentId: string
  legacyStep?: CodexConfigPatch
  embeddedAgent?: CodexConfigPatch
  step?: CodexConfigPatch
}

const CODEX_CONFIG_RESOURCE_PREFIX = 'codex-config:'

function ensureRuntimeResources(ctx: ExecutionContext) {
  if (!ctx.runtimeResources) {
    ctx.runtimeResources = { values: new Map(), cleanupCallbacks: new Set() }
  }
  return ctx.runtimeResources
}

async function loadLayers(workflowId: string): Promise<FrozenCodexLayers> {
  const [row] = await db
    .select({
      workflowConfig: workflow.codexConfig,
      workspaceConfig: workspace.codexConfig,
    })
    .from(workflow)
    .leftJoin(workspace, eq(workspace.id, workflow.workspaceId))
    .where(eq(workflow.id, workflowId))
    .limit(1)

  return {
    workspace: parseCodexConfigPatch(row?.workspaceConfig),
    workflow: parseCodexWorkflowConfig(row?.workflowConfig),
  }
}

/**
 * Loads each workflow's layers once per uninterrupted execution. The cached
 * Promise also deduplicates parallel Codex blocks that start in the same tick.
 */
export async function getFrozenCodexLayers(
  ctx: ExecutionContext,
  workflowId = ctx.workflowId
): Promise<FrozenCodexLayers> {
  const resources = ensureRuntimeResources(ctx)
  const key = `${CODEX_CONFIG_RESOURCE_PREFIX}${workflowId}`
  const existing = resources.values.get(key)
  if (existing) return existing as Promise<FrozenCodexLayers>

  const pending = loadLayers(workflowId)
  resources.values.set(key, pending)
  return pending
}

/** Resolves system → legacy fallback → workspace → workflow → Agent → Step. */
export async function resolveExecutionCodexConfig(
  ctx: ExecutionContext,
  { agentId, legacyStep, embeddedAgent, step }: ResolveExecutionCodexConfigOptions
): Promise<CodexConfigResolution> {
  const layers = await getFrozenCodexLayers(ctx)
  return resolveCodexConfig({
    workspace: layers.workspace,
    workflow: layers.workflow.defaults,
    legacyStep,
    embeddedAgent,
    agent: layers.workflow.agents[agentId],
    step,
  })
}
