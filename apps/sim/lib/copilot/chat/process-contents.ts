import { db, dbReplica } from '@sim/db'
import { knowledgeBase, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  getActiveWorkflowRecord,
} from '@sim/platform-authz/workflow'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { QueryLogs } from '@/lib/copilot/generated/tool-catalog-v1'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import {
  buildVfsFolderPathMap,
  canonicalBlockVfsPath,
  canonicalInterfaceVfsPath,
  canonicalKnowledgeBaseVfsDir,
  canonicalTableVfsPath,
  canonicalWorkflowVfsDir,
  canonicalWorkspaceFilePath,
  encodeVfsPathSegments,
  encodeVfsSegment,
} from '@/lib/copilot/vfs/path-utils'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { getInterfaceById } from '@/lib/interfaces'
import { toOverview } from '@/lib/logs/log-views'
import type { TraceSpan } from '@/lib/logs/types'
import { mcpService } from '@/lib/mcp/service'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getTableById } from '@/lib/table/service'
import { getWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getSkillById } from '@/lib/workflows/skills/operations'
import { listFolders } from '@/lib/workflows/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { escapeRegExp } from '@/executor/constants'
import type { ChatContext } from '@/stores/panel'

type AgentContextType =
  | 'past_chat'
  | 'workflow'
  | 'current_workflow'
  | 'blocks'
  | 'logs'
  | 'knowledge'
  | 'table'
  | 'file'
  | 'workflow_block'
  | 'docs'
  | 'folder'
  | 'filefolder'
  | 'active_resource'
  | 'skill'

interface AgentContext {
  type: AgentContextType
  tag: string
  content: string
  /**
   * Canonical, URL-encoded VFS path for the tagged resource (e.g.
   * `agent/skills/My%20Skill.json`). Tagged resources are sent as path
   * pointers so the model reads them on demand via VFS tools instead of the
   * full body bloating the request. Skills are the exception: they carry both
   * `path` and the full `content` so the skill is autoloaded.
   */
  path?: string
}

const logger = createLogger('ProcessContents')

// Server-side variant (recommended for use in API routes)
export async function processContextsServer(
  contexts: ChatContext[] | undefined,
  userId: string,
  userMessage?: string,
  currentWorkspaceId?: string,
  chatId?: string
): Promise<AgentContext[]> {
  if (!Array.isArray(contexts) || contexts.length === 0) return []
  const tasks = contexts.map(async (ctx) => {
    try {
      if (ctx.kind === 'skill' && ctx.skillId && currentWorkspaceId) {
        return await processSkillFromDb(
          ctx.skillId,
          currentWorkspaceId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'mcp' && ctx.serverId && currentWorkspaceId) {
        const tools = await mcpService.discoverServerTools(userId, ctx.serverId, currentWorkspaceId)
        if (tools.length === 0) return null
        const toolLines = tools.map((tool) => {
          const name = createMcpToolId(tool.serverId, tool.name)
          return `- ${name}: ${tool.description || tool.name}`
        })
        return {
          type: 'mcp',
          tag: ctx.label ? `/${ctx.label}` : '/',
          content: [
            `The user explicitly enabled the MCP server "${ctx.label || ctx.serverId}" for this turn.`,
            'Its request-scoped tools are listed below. Load a tool with load_custom_tool({ type: "mcp", name: "<exact name>" }) before calling it.',
            'Do not narrate discovery, loading, tool-name selection, or retries. Call the tool first, then respond once with the result. Never claim the server works before a successful tool result. Do not automatically retry a timed-out or abandoned MCP call.',
            ...toolLines,
          ].join('\n'),
        }
      }
      if (ctx.kind === 'past_chat' && ctx.chatId) {
        return await processPastChatFromDb(
          ctx.chatId,
          userId,
          ctx.label ? `@${ctx.label}` : '@',
          currentWorkspaceId
        )
      }
      if ((ctx.kind === 'workflow' || ctx.kind === 'current_workflow') && ctx.workflowId) {
        return await processWorkflowFromDb(
          ctx.workflowId,
          userId,
          ctx.label ? `@${ctx.label}` : '@',
          ctx.kind,
          currentWorkspaceId,
          chatId
        )
      }
      if (ctx.kind === 'knowledge' && ctx.knowledgeId) {
        return await processKnowledgeFromDb(
          ctx.knowledgeId,
          userId,
          ctx.label ? `@${ctx.label}` : '@',
          currentWorkspaceId
        )
      }
      if (ctx.kind === 'blocks' && ctx.blockIds?.length > 0) {
        return await processBlockMetadata(
          ctx.blockIds[0],
          ctx.label ? `@${ctx.label}` : '@',
          userId,
          currentWorkspaceId
        )
      }
      if (ctx.kind === 'logs' && ctx.executionId) {
        return await processExecutionLogFromDb(
          ctx.executionId,
          userId,
          ctx.label ? `@${ctx.label}` : '@',
          currentWorkspaceId
        )
      }
      if (ctx.kind === 'workflow_block' && ctx.workflowId && ctx.blockId) {
        return await processWorkflowBlockFromDb(
          ctx.workflowId,
          userId,
          ctx.blockId,
          ctx.label,
          currentWorkspaceId
        )
      }
      if (ctx.kind === 'table' && ctx.tableId && currentWorkspaceId) {
        const result = await resolveTableResource(ctx.tableId, currentWorkspaceId)
        if (!result) return null
        return {
          type: 'table',
          tag: ctx.label ? `@${ctx.label}` : '@',
          content: result.content,
          path: result.path,
        }
      }
      if (ctx.kind === 'file' && ctx.fileId && currentWorkspaceId) {
        const result = await resolveFileResource(ctx.fileId, currentWorkspaceId)
        if (!result) return null
        return {
          type: 'file',
          tag: ctx.label ? `@${ctx.label}` : '@',
          content: result.content,
          path: result.path,
        }
      }
      if (ctx.kind === 'folder' && 'folderId' in ctx && ctx.folderId && currentWorkspaceId) {
        const result = await resolveFolderResource(ctx.folderId, currentWorkspaceId)
        if (!result) return null
        return {
          type: 'folder',
          tag: ctx.label ? `@${ctx.label}` : '@',
          content: result.content,
          path: result.path,
        }
      }
      if (ctx.kind === 'filefolder' && ctx.fileFolderId && currentWorkspaceId) {
        const result = await resolveFileFolderResource(ctx.fileFolderId, currentWorkspaceId)
        if (!result) return null
        return {
          type: 'filefolder',
          tag: ctx.label ? `@${ctx.label}` : '@',
          content: result.content,
          path: result.path,
        }
      }
      if (ctx.kind === 'scheduledtask' && ctx.scheduleId && currentWorkspaceId) {
        const result = await resolveScheduledTaskResource(ctx.scheduleId, currentWorkspaceId)
        if (!result) return null
        return {
          type: 'active_resource',
          tag: ctx.label ? `@${ctx.label}` : '@',
          content: result.content,
          path: result.path,
        }
      }
      if (ctx.kind === 'interface' && ctx.interfaceId && currentWorkspaceId) {
        const result = await resolveInterfaceResource(ctx.interfaceId, currentWorkspaceId)
        if (!result) return null
        return {
          type: 'active_resource',
          tag: ctx.label ? `@${ctx.label}` : '@',
          content: result.content,
          path: result.path,
        }
      }
      if (ctx.kind === 'docs') {
        try {
          const { searchDocumentationServerTool } = await import(
            '@/lib/copilot/tools/server/docs/search-documentation'
          )
          const rawQuery = (userMessage || '').trim() || ctx.label || 'Sim documentation'
          const query = sanitizeMessageForDocs(rawQuery, contexts)
          const res = await searchDocumentationServerTool.execute({ query, topK: 10 })
          const content = JSON.stringify(res?.results || [])
          return { type: 'docs', tag: ctx.label ? `@${ctx.label}` : '@', content }
        } catch (e) {
          logger.error('Failed to process docs context', e)
          return null
        }
      }
      return null
    } catch (error) {
      logger.error('Failed processing context (server)', { ctx, error })
      return null
    }
  })
  const results = await Promise.all(tasks)
  const filtered = results.filter(
    (r): r is AgentContext =>
      !!r &&
      ((typeof r.content === 'string' && r.content.trim().length > 0) ||
        (typeof r.path === 'string' && r.path.length > 0))
  )
  logger.info('Processed contexts (server)', {
    totalRequested: contexts.length,
    totalProcessed: filtered.length,
    kinds: Array.from(filtered.reduce((s, r) => s.add(r.type), new Set<string>())),
  })
  return filtered
}

function sanitizeMessageForDocs(rawMessage: string, contexts: ChatContext[] | undefined): string {
  if (!rawMessage) return ''
  if (!Array.isArray(contexts) || contexts.length === 0) {
    // No context mapping; conservatively strip all @mentions-like tokens
    const stripped = rawMessage
      .replace(/(^|\s)@([^\s]+)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return stripped
  }

  // Gather labels by kind
  const blockLabels = new Set(
    contexts
      .filter((c) => c.kind === 'blocks')
      .map((c) => c.label)
      .filter((l): l is string => typeof l === 'string' && l.length > 0)
  )
  const nonBlockLabels = new Set(
    contexts
      .filter((c) => c.kind !== 'blocks')
      .map((c) => c.label)
      .filter((l): l is string => typeof l === 'string' && l.length > 0)
  )

  let result = rawMessage

  // 1) Remove all non-block mentions entirely
  for (const label of nonBlockLabels) {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(label)}(?!\\S)`, 'g')
    result = result.replace(pattern, ' ')
  }

  // 2) For block mentions, strip the '@' but keep the block name
  for (const label of blockLabels) {
    const pattern = new RegExp(`@${escapeRegExp(label)}(?!\\S)`, 'g')
    result = result.replace(pattern, label)
  }

  // 3) Remove any remaining @mentions (unknown or not in contexts)
  result = result.replace(/(^|\s)@([^\s]+)/g, ' ')

  // Normalize whitespace
  result = result.replace(/\s{2,}/g, ' ').trim()
  return result
}

async function processSkillFromDb(
  skillId: string,
  workspaceId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    const s = await getSkillById({ skillId, workspaceId })
    if (!s) return null
    // Skills are autoloaded: carry the full SKILL.md body so the Go side can
    // inject it into the dynamic system message for the turn. The path lets the
    // model re-read the canonical VFS file if it needs to.
    const path = `agent/skills/${encodeVfsSegment(s.name)}.json`
    return { type: 'skill', tag, content: s.content, path }
  } catch (error) {
    logger.error('Error processing skill context (db)', { skillId, error })
    return null
  }
}

async function processPastChatFromDb(
  chatId: string,
  userId: string,
  tag: string,
  currentWorkspaceId?: string
): Promise<AgentContext | null> {
  try {
    const { getAccessibleCopilotChatWithMessages } = await import('./lifecycle')
    const chat = await getAccessibleCopilotChatWithMessages(chatId, userId)
    if (!chat) {
      return null
    }

    if (currentWorkspaceId) {
      if (chat.workspaceId && chat.workspaceId !== currentWorkspaceId) {
        return null
      }
      if (chat.workflowId) {
        const activeWorkflow = await getActiveWorkflowRecord(chat.workflowId)
        if (!activeWorkflow || activeWorkflow.workspaceId !== currentWorkspaceId) {
          return null
        }
      }
    }
    const messages = Array.isArray(chat.messages) ? (chat as any).messages : []
    const content = messages
      .map((m: any) => {
        const role = m.role || 'user'
        let text = ''
        if (Array.isArray(m.contentBlocks) && m.contentBlocks.length > 0) {
          text = m.contentBlocks
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => String(b.content || ''))
            .join('')
            .trim()
        }
        if (!text && typeof m.content === 'string') text = m.content
        return `${role}: ${text}`.trim()
      })
      .filter((s: string) => s.length > 0)
      .join('\n')
    logger.info('Processed past_chat context from DB', {
      chatId,
      length: content.length,
      lines: content ? content.split('\n').length : 0,
    })
    return { type: 'past_chat', tag, content }
  } catch (error) {
    logger.error('Error processing past chat from db', { chatId, error })
    return null
  }
}

/**
 * Resolve a workflow folder id to its canonical, per-segment-encoded VFS folder
 * path. Returns null for root-level workflows or when the folder can't be
 * resolved. Uses the shared {@link buildVfsFolderPathMap} so the pointer path
 * matches what the workspace VFS serves.
 */
async function resolveWorkflowFolderPath(
  workspaceId: string | null | undefined,
  folderId: string | null | undefined
): Promise<string | null> {
  if (!folderId || !workspaceId) return null
  try {
    const folders = await listFolders(workspaceId)
    return buildVfsFolderPathMap(folders).get(folderId) ?? null
  } catch (error) {
    logger.warn('Failed to resolve workflow folder path', { workspaceId, folderId, error })
    return null
  }
}

async function processWorkflowFromDb(
  workflowId: string,
  userId: string | undefined,
  tag: string,
  kind: 'workflow' | 'current_workflow' = 'workflow',
  currentWorkspaceId?: string,
  _chatId?: string
): Promise<AgentContext | null> {
  try {
    let workflowRecord: Awaited<ReturnType<typeof getActiveWorkflowRecord>> = null

    if (userId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return null
      }
      if (currentWorkspaceId && authorization.workflow?.workspaceId !== currentWorkspaceId) {
        return null
      }
      workflowRecord = authorization.workflow ?? null
    }

    if (!workflowRecord) {
      workflowRecord = await getActiveWorkflowRecord(workflowId)
    }
    if (!workflowRecord) return null

    // Emit a VFS-path pointer instead of the full (potentially huge) workflow
    // state/meta. `current_workflow` points at the live state; a plain
    // `workflow` mention points at the lighter metadata file.
    const folderPath = await resolveWorkflowFolderPath(
      workflowRecord.workspaceId ?? currentWorkspaceId,
      workflowRecord.folderId
    )
    const dir = canonicalWorkflowVfsDir({ name: workflowRecord.name, folderPath })
    const path = kind === 'current_workflow' ? `${dir}/state.json` : `${dir}/meta.json`
    return { type: kind, tag, content: '', path }
  } catch (error) {
    logger.error('Error processing workflow context', { workflowId, error })
    return null
  }
}

async function processPastChat(chatId: string, tagOverride?: string): Promise<AgentContext | null> {
  try {
    // boundary-raw-fetch: GET /api/mothership/chat?chatId=... has no defineRouteContract;
    // the route forwards to the copilot chat handler and emits a free-form chat envelope
    // that isn't covered by mothershipChatGetQuerySchema or copilotChatGetContract.
    const resp = await fetch(`/api/mothership/chat?chatId=${encodeURIComponent(chatId)}`)
    if (!resp.ok) {
      logger.error('Failed to fetch past chat', { chatId, status: resp.status })
      return null
    }
    const data = await resp.json()
    const messages = Array.isArray(data?.chat?.messages) ? data.chat.messages : []
    const content = messages
      .map((m: any) => {
        const role = m.role || 'user'
        // Prefer contentBlocks text if present (joins text blocks), else use content
        let text = ''
        if (Array.isArray(m.contentBlocks) && m.contentBlocks.length > 0) {
          text = m.contentBlocks
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => String(b.content || ''))
            .join('')
            .trim()
        }
        if (!text && typeof m.content === 'string') text = m.content
        return `${role}: ${text}`.trim()
      })
      .filter((s: string) => s.length > 0)
      .join('\n')
    logger.info('Processed past_chat context via API', { chatId, length: content.length })

    return { type: 'past_chat', tag: tagOverride || '@', content }
  } catch (error) {
    logger.error('Error processing past chat', { chatId, error })
    return null
  }
}

// Back-compat alias; used by processContexts above
async function processPastChatViaApi(chatId: string, tag?: string) {
  return processPastChat(chatId, tag)
}

async function processKnowledgeFromDb(
  knowledgeBaseId: string,
  userId: string | undefined,
  tag: string,
  currentWorkspaceId?: string
): Promise<AgentContext | null> {
  try {
    if (userId) {
      const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)
      if (!accessCheck.hasAccess) {
        return null
      }
      if (currentWorkspaceId && accessCheck.knowledgeBase?.workspaceId !== currentWorkspaceId) {
        return null
      }
    }

    const conditions = [eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)]
    if (currentWorkspaceId) {
      conditions.push(eq(knowledgeBase.workspaceId, currentWorkspaceId))
    }
    const kbRows = await dbReplica
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
      })
      .from(knowledgeBase)
      .where(and(...conditions))
      .limit(1)
    const kb = kbRows?.[0]
    if (!kb) return null

    return {
      type: 'knowledge',
      tag,
      content: '',
      path: `${canonicalKnowledgeBaseVfsDir(kb.name)}/meta.json`,
    }
  } catch (error) {
    logger.error('Error processing knowledge context (db)', { knowledgeBaseId, error })
    return null
  }
}

async function processBlockMetadata(
  blockId: string,
  tag: string,
  userId?: string,
  workspaceId?: string
): Promise<AgentContext | null> {
  try {
    const permissionConfig =
      userId && workspaceId ? await getUserPermissionConfig(userId, workspaceId) : null
    const allowedIntegrations =
      permissionConfig?.allowedIntegrations ?? getAllowedIntegrationsFromEnv()
    if (allowedIntegrations != null && !allowedIntegrations.includes(blockId.toLowerCase())) {
      logger.debug('Block not allowed by integration allowlist', { blockId, userId })
      return null
    }

    const { registry: blockRegistry } = await import('@/blocks/registry')
    if (!(blockRegistry as any)[blockId]) {
      return null
    }

    return { type: 'blocks', tag, content: '', path: canonicalBlockVfsPath(blockId) }
  } catch (error) {
    logger.error('Error processing block metadata', { blockId, error })
    return null
  }
}

async function processWorkflowBlockFromDb(
  workflowId: string,
  userId: string | undefined,
  blockId: string,
  label?: string,
  currentWorkspaceId?: string
): Promise<AgentContext | null> {
  try {
    let workflowRecord: Awaited<ReturnType<typeof getActiveWorkflowRecord>> = null
    if (userId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return null
      }
      if (currentWorkspaceId && authorization.workflow?.workspaceId !== currentWorkspaceId) {
        return null
      }
      workflowRecord = authorization.workflow ?? null
    }

    if (!workflowRecord) {
      workflowRecord = await getActiveWorkflowRecord(workflowId)
    }
    if (!workflowRecord) return null

    const folderPath = await resolveWorkflowFolderPath(
      workflowRecord.workspaceId ?? currentWorkspaceId,
      workflowRecord.folderId
    )
    const dir = canonicalWorkflowVfsDir({ name: workflowRecord.name, folderPath })
    const tag = label ? `@${label} in Workflow` : `@${blockId} in Workflow`
    // Point at the workflow state; the block id tells the model which node to
    // look up inside state.json without inlining the full block definition.
    return {
      type: 'workflow_block',
      tag,
      content: `Block id: ${blockId}`,
      path: `${dir}/state.json`,
    }
  } catch (error) {
    logger.error('Error processing workflow_block context', { workflowId, blockId, error })
    return null
  }
}

/**
 * Cap on the serialized summary (including the block overview tree) sent for
 * a tagged run. `toOverview` already excludes every block's input/output, so
 * this is a safety net against pathological span counts, not the primary
 * defense — mirrors `MAX_FULL_RESULT_BYTES` in `query-logs.ts`, scaled down
 * since this lands in the prompt unconditionally rather than behind an
 * explicit tool call.
 */
const MAX_LOG_SUMMARY_BYTES = 64 * 1024

/**
 * Resolve a tagged run to a compact summary instead of its full execution
 * trace. A run's trace can carry every block's input/output plus nested
 * tool-call spans, which is unbounded and would repeatedly blow the context
 * window if inlined directly. The summary includes the block-level overview
 * tree (name/type/status/timing/cost, no input or output — the same
 * projection `query_logs`'s `overview` view returns) so the model can see
 * which block failed without a round trip, and points it at `query_logs` for
 * that block's actual input/output/error, or to grep the trace.
 *
 * `materializeExecutionData` only unwraps a top-level object-storage pointer,
 * for runs whose whole trace was offloaded as one blob — a no-op for the
 * common inline case. Individual span input/output stay as large-value refs;
 * `toOverview` never resolves those.
 */
async function processExecutionLogFromDb(
  executionId: string,
  userId: string | undefined,
  tag: string,
  currentWorkspaceId?: string
): Promise<AgentContext | null> {
  try {
    const { workflowExecutionLogs, workflow } = await import('@sim/db/schema')
    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        workspaceId: workflowExecutionLogs.workspaceId,
        executionId: workflowExecutionLogs.executionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        costTotal: workflowExecutionLogs.costTotal,
        workflowName: workflow.name,
      })
      .from(workflowExecutionLogs)
      .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    const log = rows?.[0] as any
    if (!log) return null

    if (userId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: log.workflowId,
        userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return null
      }
      if (currentWorkspaceId && authorization.workflow?.workspaceId !== currentWorkspaceId) {
        return null
      }
    }

    const { materializeExecutionData } = await import('@/lib/logs/execution/trace-store')
    const executionData = (await materializeExecutionData(
      log.executionData as Record<string, unknown> | null,
      { workspaceId: log.workspaceId, workflowId: log.workflowId, executionId: log.executionId }
    )) as { traceSpans?: TraceSpan[] } | undefined
    const overview = executionData?.traceSpans?.length
      ? toOverview(executionData.traceSpans)
      : undefined

    const summary = {
      id: log.id,
      workflowId: log.workflowId,
      executionId: log.executionId,
      level: log.level,
      trigger: log.trigger,
      startedAt: log.startedAt?.toISOString?.() || String(log.startedAt),
      endedAt: log.endedAt?.toISOString?.() || (log.endedAt ? String(log.endedAt) : null),
      totalDurationMs: log.totalDurationMs ?? null,
      workflowName: log.workflowName || '',
      cost: log.costTotal != null ? { total: Number(log.costTotal) } : undefined,
      overview,
      note: `For a block's input/output/error, or to grep the trace, call ${QueryLogs.id} with executionId: '${log.executionId}' — view: 'full' (scope with blockId or blockName), or pattern to grep.`,
    }

    if (overview && JSON.stringify(summary).length > MAX_LOG_SUMMARY_BYTES) {
      summary.overview = undefined
    }

    const content = JSON.stringify(summary)
    return { type: 'logs', tag, content }
  } catch (error) {
    logger.error('Error processing execution log context (db)', { executionId, error })
    return null
  }
}

// ---------------------------------------------------------------------------
// Active resource context resolution (direct DB lookups, workspace-scoped)
// ---------------------------------------------------------------------------

/**
 * Resolves the content of the currently active resource tab via direct DB
 * queries. Each resource type has a dedicated handler that fetches only the
 * single resource needed — avoiding the full VFS materialisation overhead.
 */
export async function resolveActiveResourceContext(
  resourceType: string,
  resourceId: string,
  workspaceId: string,
  userId: string,
  chatId?: string
): Promise<AgentContext | null> {
  try {
    switch (resourceType) {
      case 'workflow': {
        const ctx = await processWorkflowFromDb(
          resourceId,
          userId,
          '@active_resource',
          'current_workflow',
          workspaceId,
          chatId
        )
        if (!ctx) return null
        return {
          type: 'active_resource',
          tag: '@active_resource',
          content: ctx.content,
          path: ctx.path,
        }
      }
      case 'knowledgebase': {
        const ctx = await processKnowledgeFromDb(
          resourceId,
          userId,
          '@active_resource',
          workspaceId
        )
        if (!ctx) return null
        return {
          type: 'active_resource',
          tag: '@active_resource',
          content: ctx.content,
          path: ctx.path,
        }
      }
      case 'table': {
        return await resolveTableResource(resourceId, workspaceId)
      }
      case 'interface': {
        return await resolveInterfaceResource(resourceId, workspaceId)
      }
      case 'file': {
        return await resolveFileResource(resourceId, workspaceId)
      }
      case 'folder': {
        return await resolveFolderResource(resourceId, workspaceId)
      }
      case 'filefolder': {
        return await resolveFileFolderResource(resourceId, workspaceId)
      }
      case 'scheduledtask': {
        return await resolveScheduledTaskResource(resourceId, workspaceId)
      }
      default:
        return null
    }
  } catch (error) {
    logger.error('Failed to resolve active resource context', { resourceType, resourceId, error })
    return null
  }
}
async function resolveTableResource(
  tableId: string,
  workspaceId: string
): Promise<AgentContext | null> {
  const table = await getTableById(tableId)
  if (!table) return null
  if (table.workspaceId !== workspaceId) return null
  return {
    type: 'active_resource',
    tag: '@active_resource',
    content: '',
    path: canonicalTableVfsPath(table.name),
  }
}

/**
 * Points the agent at the interface's materialized `meta.json` rather than
 * inlining its layout, matching the table/file resolvers. The VFS is the read
 * path; `user_interface` is the write path.
 */
async function resolveInterfaceResource(
  interfaceId: string,
  workspaceId: string
): Promise<AgentContext | null> {
  const definition = await getInterfaceById(interfaceId)
  if (!definition) return null
  if (definition.workspaceId !== workspaceId) return null
  return {
    type: 'active_resource',
    tag: '@active_resource',
    content: '',
    path: canonicalInterfaceVfsPath(definition.name),
  }
}

async function resolveScheduledTaskResource(
  scheduleId: string,
  workspaceId: string
): Promise<AgentContext | null> {
  const [row] = await db
    .select({ id: workflowSchedule.id, jobTitle: workflowSchedule.jobTitle })
    .from(workflowSchedule)
    .where(
      and(
        eq(workflowSchedule.id, scheduleId),
        eq(workflowSchedule.sourceWorkspaceId, workspaceId),
        eq(workflowSchedule.sourceType, 'job'),
        isNull(workflowSchedule.archivedAt),
        // Mirror the VFS materializer (workspace-vfs `materializeJobs`), which
        // excludes completed jobs — otherwise we'd point at a meta.json it never
        // wrote and the agent's read would dangle.
        ne(workflowSchedule.status, 'completed')
      )
    )
    .limit(1)
  if (!row) return null
  // The VFS materializes jobs at `jobs/{sanitized title}/meta.json` (see
  // workspace-vfs `materializeJobs`); emit the same lightweight path pointer so
  // the agent reads it via the VFS instead of us inlining the (heavy) row.
  return {
    type: 'active_resource',
    tag: '@active_resource',
    content: '',
    path: `jobs/${normalizeVfsSegment(row.jobTitle || row.id)}/meta.json`,
  }
}

async function resolveFileResource(
  fileId: string,
  workspaceId: string
): Promise<AgentContext | null> {
  const record = await getWorkspaceFile(workspaceId, fileId)
  if (!record) return null
  return {
    type: 'active_resource',
    tag: '@active_resource',
    content: '',
    path: canonicalWorkspaceFilePath({ folderPath: record.folderPath, name: record.name }),
  }
}

async function resolveFileFolderResource(
  folderId: string,
  workspaceId: string
): Promise<AgentContext | null> {
  try {
    const rawPath = await getWorkspaceFileFolderPath(workspaceId, folderId)
    if (!rawPath) return null
    const encoded = encodeVfsPathSegments(rawPath.split('/').filter(Boolean))
    return {
      type: 'active_resource',
      tag: '@active_resource',
      content: '',
      path: `files/${encoded}`,
    }
  } catch (error) {
    logger.error('Failed to resolve file folder resource', { folderId, error })
    return null
  }
}

async function resolveFolderResource(
  folderId: string,
  workspaceId: string
): Promise<AgentContext | null> {
  const folderPath = await resolveWorkflowFolderPath(workspaceId, folderId)
  if (!folderPath) return null
  return {
    type: 'active_resource',
    tag: '@active_resource',
    content: '',
    path: `workflows/${folderPath}`,
  }
}
