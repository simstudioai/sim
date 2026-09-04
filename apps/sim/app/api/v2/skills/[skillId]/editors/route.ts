import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  type V2SkillEditor,
  v2GrantSkillEditorContract,
  v2ListSkillEditorsContract,
  v2RevokeSkillEditorContract,
} from '@/lib/api/contracts/v2/skills'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import type { SkillEditor } from '@/lib/skills/access'
import { skillOperations } from '@/lib/skills/application/operations'
import {
  grantSkillEditorUseCase,
  listSkillEditorsUseCase,
  revokeSkillEditorUseCase,
} from '@/lib/skills/application/use-cases'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const skillResourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Skill not found',
})

function toV2SkillEditor(editor: SkillEditor): V2SkillEditor {
  if (!editor.userEmail) throw new Error('Skill editor is missing an email address')
  return {
    email: editor.userEmail,
    name: editor.userName,
    image: editor.userImage ?? null,
    isWorkspaceAdmin: editor.isWorkspaceAdmin,
  }
}

function skillEditorCursorScope(skillId: string, query: { workspaceId: string }) {
  return cursorScopeKey(cursorRoute(v2ListSkillEditorsContract, { skillId }), {
    workspaceId: query.workspaceId,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListSkillEditorsContract,
  operation: skillOperations.listEditors,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: skillResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    skillId: params.skillId,
    workspaceId: query.workspaceId,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    offset: decodeOffsetCursor(
      query.cursor,
      cursorSortKey(query.sortBy, query.sortOrder),
      skillEditorCursorScope(params.skillId, query)
    ),
  }),
  useCase: listSkillEditorsUseCase,
  present: ({ editors, hasMore, offset, limit }, { params, query }) => ({
    data: editors.map(toV2SkillEditor),
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          skillEditorCursorScope(params.skillId, query),
          offset + limit
        )
      : null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2GrantSkillEditorContract,
  operation: skillOperations.grantEditor,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: skillResourceErrorPolicy,
  mapInput: ({ params, body }) => ({
    skillId: params.skillId,
    workspaceId: body.workspaceId,
    target: { kind: 'email' as const, email: body.email },
  }),
  useCase: grantSkillEditorUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (!result.created || !isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'skill_shared',
      { skill_id: input.skillId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
  present: ({ editor }) => ({ data: toV2SkillEditor(editor) }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})

export const DELETE = defineV2JsonRoute({
  contract: v2RevokeSkillEditorContract,
  operation: skillOperations.revokeEditor,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: skillResourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    skillId: params.skillId,
    workspaceId: query.workspaceId,
    target: { kind: 'email' as const, email: query.email },
  }),
  useCase: revokeSkillEditorUseCase,
  onSuccess: ({ principal, input, result }) => {
    if (!isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'skill_unshared',
      { skill_id: input.skillId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
  present: ({ editor }) => {
    if (!editor.userEmail) throw new Error('Skill editor is missing an email address')
    return { data: { email: editor.userEmail, revoked: true as const } }
  },
})
