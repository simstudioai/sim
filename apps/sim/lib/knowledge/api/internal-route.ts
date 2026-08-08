import type { SessionPrincipal } from '@sim/auth/principal'
import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge/base'
import { PlatformEvents } from '@/lib/core/telemetry'
import type {
  CreateKnowledgeBaseInput,
  KnowledgeBaseResult,
} from '@/lib/knowledge/application/knowledge-bases'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { captureServerEvent } from '@/lib/posthog/server'

function serializeDate(date: Date | string): string {
  return date instanceof Date ? date.toISOString() : date
}

function toInternalKnowledgeBase(knowledgeBase: KnowledgeBaseWithCounts): KnowledgeBaseData {
  return {
    ...knowledgeBase,
    chunkingConfig: { ...knowledgeBase.chunkingConfig },
    createdAt: serializeDate(knowledgeBase.createdAt),
    updatedAt: serializeDate(knowledgeBase.updatedAt),
    deletedAt: knowledgeBase.deletedAt ? serializeDate(knowledgeBase.deletedAt) : null,
  }
}

export const internalKnowledgePresenters = {
  list({ knowledgeBases }: { knowledgeBases: KnowledgeBaseWithCounts[] }) {
    return { success: true as const, data: knowledgeBases.map(toInternalKnowledgeBase) }
  },
  create({ knowledgeBase }: KnowledgeBaseResult) {
    return { success: true as const, data: toInternalKnowledgeBase(knowledgeBase) }
  },
} as const

export const internalKnowledgeAnalytics = {
  created({
    principal,
    result: { knowledgeBase },
  }: {
    principal: SessionPrincipal
    input: CreateKnowledgeBaseInput
    result: KnowledgeBaseResult
  }): void {
    if (!knowledgeBase.workspaceId) {
      throw new Error('Created knowledge base is missing its workspace analytics scope')
    }
    PlatformEvents.knowledgeBaseCreated({
      knowledgeBaseId: knowledgeBase.id,
      name: knowledgeBase.name,
      workspaceId: knowledgeBase.workspaceId,
    })
    captureServerEvent(
      principal.userId,
      'knowledge_base_created',
      {
        knowledge_base_id: knowledgeBase.id,
        workspace_id: knowledgeBase.workspaceId,
        name: knowledgeBase.name,
      },
      {
        groups: { workspace: knowledgeBase.workspaceId },
        setOnce: { first_kb_created_at: new Date().toISOString() },
      }
    )
  },
} as const
