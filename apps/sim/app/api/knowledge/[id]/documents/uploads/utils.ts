import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import type { KnowledgeBaseAccessResult } from '@/app/api/knowledge/utils'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

export interface KnowledgeDocumentUploadActor {
  id: string
  name?: string | null
  email?: string | null
}

export async function requireKnowledgeDocumentUploadActor(): Promise<
  KnowledgeDocumentUploadActor | NextResponse
> {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  }
}

export async function requireKnowledgeDocumentUploadAccess(params: {
  knowledgeBaseId: string
  workspaceId: string
  userId: string
}): Promise<{ knowledgeBase: KnowledgeBaseAccessResult['knowledgeBase'] } | NextResponse> {
  const access = await checkKnowledgeBaseWriteAccess(params.knowledgeBaseId, params.userId)
  if (!access.hasAccess) {
    return 'notFound' in access && access.notFound
      ? NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (access.knowledgeBase.workspaceId !== params.workspaceId) {
    return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
  }
  return { knowledgeBase: access.knowledgeBase }
}

export async function requireKnowledgeDocumentUploadBilling(params: {
  workspaceId: string
  userId: string
}): Promise<BillingAttributionSnapshot | NextResponse> {
  const attribution = await resolveKnowledgeDocumentUploadAttribution(params)
  const usage = await checkAttributedUsageLimits(attribution)
  if (usage.isExceeded) {
    return NextResponse.json(
      {
        error: usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
      },
      { status: 402 }
    )
  }
  return attribution
}

export function resolveKnowledgeDocumentUploadAttribution(params: {
  workspaceId: string
  userId: string
}): Promise<BillingAttributionSnapshot> {
  return resolveBillingAttribution({
    actorUserId: params.userId,
    workspaceId: params.workspaceId,
  })
}
