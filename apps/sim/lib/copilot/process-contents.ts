import { and, eq, isNull } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { copilotChats, document, knowledgeBase, templates } from '@/db/schema'
import type { ChatContext } from '@/stores/copilot/types'

export type AgentContextType =
  | 'past_chat'
  | 'workflow'
  | 'blocks'
  | 'logs'
  | 'knowledge'
  | 'templates'

export interface AgentContext {
  type: AgentContextType
  tag: string
  content: string
}

const logger = createLogger('ProcessContents')

export async function processContexts(
  contexts: ChatContext[] | undefined
): Promise<AgentContext[]> {
  if (!Array.isArray(contexts) || contexts.length === 0) return []
  const tasks = contexts.map(async (ctx) => {
    try {
      if (ctx.kind === 'past_chat') {
        return await processPastChatViaApi(ctx.chatId, ctx.label ? `@${ctx.label}` : '@')
      }
      if (ctx.kind === 'workflow' && ctx.workflowId) {
        return await processWorkflowFromDb(ctx.workflowId, ctx.label ? `@${ctx.label}` : '@')
      }
      if (ctx.kind === 'knowledge' && (ctx as any).knowledgeId) {
        return await processKnowledgeFromDb(
          (ctx as any).knowledgeId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'blocks' && (ctx as any).blockId) {
        return await processBlockMetadata((ctx as any).blockId, ctx.label ? `@${ctx.label}` : '@')
      }
      if (ctx.kind === 'templates' && (ctx as any).templateId) {
        return await processTemplateFromDb(
          (ctx as any).templateId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      // Other kinds can be added here: workflow, blocks, logs, knowledge, templates
      return null
    } catch (error) {
      logger.error('Failed processing context', { ctx, error })
      return null
    }
  })

  const results = await Promise.all(tasks)
  return results.filter((r): r is AgentContext => !!r)
}

// Server-side variant (recommended for use in API routes)
export async function processContextsServer(
  contexts: ChatContext[] | undefined,
  userId: string
): Promise<AgentContext[]> {
  if (!Array.isArray(contexts) || contexts.length === 0) return []
  const tasks = contexts.map(async (ctx) => {
    try {
      if (ctx.kind === 'past_chat' && ctx.chatId) {
        return await processPastChatFromDb(ctx.chatId, userId, ctx.label ? `@${ctx.label}` : '@')
      }
      if (ctx.kind === 'workflow' && ctx.workflowId) {
        return await processWorkflowFromDb(ctx.workflowId, ctx.label ? `@${ctx.label}` : '@')
      }
      if (ctx.kind === 'knowledge' && (ctx as any).knowledgeId) {
        return await processKnowledgeFromDb(
          (ctx as any).knowledgeId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      if (ctx.kind === 'blocks' && (ctx as any).blockId) {
        return await processBlockMetadata((ctx as any).blockId, ctx.label ? `@${ctx.label}` : '@')
      }
      if (ctx.kind === 'templates' && (ctx as any).templateId) {
        return await processTemplateFromDb(
          (ctx as any).templateId,
          ctx.label ? `@${ctx.label}` : '@'
        )
      }
      return null
    } catch (error) {
      logger.error('Failed processing context (server)', { ctx, error })
      return null
    }
  })
  const results = await Promise.all(tasks)
  const filtered = results.filter(
    (r): r is AgentContext => !!r && typeof r.content === 'string' && r.content.trim().length > 0
  )
  logger.info('Processed contexts (server)', {
    totalRequested: contexts.length,
    totalProcessed: filtered.length,
    kinds: Array.from(filtered.reduce((s, r) => s.add(r.type), new Set<string>())),
  })
  return filtered
}

async function processPastChatFromDb(
  chatId: string,
  userId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    const rows = await db
      .select({ messages: copilotChats.messages })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)
    const messages = Array.isArray(rows?.[0]?.messages) ? (rows[0] as any).messages : []
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

async function processWorkflowFromDb(
  workflowId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    const normalized = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalized) {
      logger.warn('No normalized workflow data found', { workflowId })
      return null
    }
    const workflowState = {
      blocks: normalized.blocks || {},
      edges: normalized.edges || [],
      loops: normalized.loops || {},
      parallels: normalized.parallels || {},
    }
    // Match get-user-workflow format: just the workflow state JSON
    const content = JSON.stringify(workflowState, null, 2)
    logger.info('Processed workflow context', {
      workflowId,
      blocks: Object.keys(workflowState.blocks || {}).length,
      edges: workflowState.edges.length,
    })
    return { type: 'workflow', tag, content }
  } catch (error) {
    logger.error('Error processing workflow context', { workflowId, error })
    return null
  }
}

async function processPastChat(chatId: string, tagOverride?: string): Promise<AgentContext | null> {
  try {
    const resp = await fetch(`/api/copilot/chat/${encodeURIComponent(chatId)}`)
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
  tag: string
): Promise<AgentContext | null> {
  try {
    // Load KB metadata
    const kbRows = await db
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        updatedAt: knowledgeBase.updatedAt,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)
    const kb = kbRows?.[0]
    if (!kb) return null

    // Load up to 20 recent doc filenames
    const docRows = await db
      .select({ filename: document.filename })
      .from(document)
      .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), isNull(document.deletedAt)))
      .limit(20)

    const sampleDocuments = docRows.map((d: any) => d.filename).filter(Boolean)
    // We don't have total via this quick select; fallback to sample count
    const summary = {
      id: kb.id,
      name: kb.name,
      docCount: sampleDocuments.length,
      sampleDocuments,
    }
    const content = JSON.stringify(summary)
    return { type: 'knowledge', tag, content }
  } catch (error) {
    logger.error('Error processing knowledge context (db)', { knowledgeBaseId, error })
    return null
  }
}

async function processBlockMetadata(blockId: string, tag: string): Promise<AgentContext | null> {
  try {
    // Reuse registry to match get_blocks_metadata tool result
    const { registry: blockRegistry } = await import('@/blocks/registry')
    const { tools: toolsRegistry } = await import('@/tools/registry')
    const SPECIAL_BLOCKS_METADATA: Record<string, any> = {}

    let metadata: any = {}
    if ((SPECIAL_BLOCKS_METADATA as any)[blockId]) {
      metadata = { ...(SPECIAL_BLOCKS_METADATA as any)[blockId] }
      metadata.tools = metadata.tools?.access || []
    } else {
      const blockConfig: any = (blockRegistry as any)[blockId]
      if (!blockConfig) {
        return null
      }
      metadata = {
        id: blockId,
        name: blockConfig.name || blockId,
        description: blockConfig.description || '',
        longDescription: blockConfig.longDescription,
        category: blockConfig.category,
        bgColor: blockConfig.bgColor,
        inputs: blockConfig.inputs || {},
        outputs: blockConfig.outputs || {},
        tools: blockConfig.tools?.access || [],
        hideFromToolbar: blockConfig.hideFromToolbar,
      }
      if (blockConfig.subBlocks && Array.isArray(blockConfig.subBlocks)) {
        metadata.subBlocks = (blockConfig.subBlocks as any[]).map((sb: any) => ({
          id: sb.id,
          name: sb.name,
          type: sb.type,
          description: sb.description,
          default: sb.default,
          options: Array.isArray(sb.options) ? sb.options : [],
        }))
      } else {
        metadata.subBlocks = []
      }
    }

    if (Array.isArray(metadata.tools) && metadata.tools.length > 0) {
      metadata.toolDetails = {}
      for (const toolId of metadata.tools) {
        const tool = (toolsRegistry as any)[toolId]
        if (tool) {
          metadata.toolDetails[toolId] = { name: tool.name, description: tool.description }
        }
      }
    }

    const content = JSON.stringify({ metadata })
    return { type: 'blocks', tag, content }
  } catch (error) {
    logger.error('Error processing block metadata', { blockId, error })
    return null
  }
}

async function processTemplateFromDb(
  templateId: string,
  tag: string
): Promise<AgentContext | null> {
  try {
    const rows = await db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        category: templates.category,
        author: templates.author,
        stars: templates.stars,
        state: templates.state,
      })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1)
    const t = rows?.[0]
    if (!t) return null
    const workflowState = (t as any).state || {}
    // Match get-user-workflow format: just the workflow state JSON
    const summary = {
      id: t.id,
      name: t.name,
      description: t.description || '',
      category: t.category,
      author: t.author,
      stars: t.stars || 0,
      workflow: workflowState,
    }
    const content = JSON.stringify(summary)
    return { type: 'templates', tag, content }
  } catch (error) {
    logger.error('Error processing template context (db)', { templateId, error })
    return null
  }
}
