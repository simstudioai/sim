import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const HUMAN_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const HTTP_SKILL_EDITOR_READ_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
} as const
const HUMAN_HTTP_SKILL_EDITOR_POLICY = {
  principalKinds: ['session', 'personal_api_key'],
} as const

/**
 * Every skill write is human-subject-only. Reads are not.
 *
 * `update`, `upsert`, and `delete` are not gated on workspace role at all —
 * their floor is `read` because the real authority is the per-skill editor row
 * that `resolveEditableSkill` checks against the acting user. A workspace key
 * has no user subject to check, so those operations deny it:
 * `requirePrincipalSubjectUserId` would otherwise throw an unclassified error
 * and surface as a caller-reachable `500` instead of a `403`. Widening them is
 * not a policy flip — it needs an authorization model for a keyless principal
 * against per-skill editors, which does not exist.
 *
 * `create` denies a workspace key too, even though workspace `write` is a role
 * a key can express. A key that created a skill could never update or delete
 * it, so it could only accumulate rows beyond its own reach — and the row would
 * not be attributable to it either: `create` attributes through
 * `resolvePrincipalAttribution`, which maps a workspace key to the workspace's
 * billing owner, minting a `skill_member` editor grant for a human who did not
 * act. Denying it keeps the whole lifecycle under one authorization model.
 * Pinned in `operations.test.ts`.
 */
/**
 * Every operation declares `skills.use`. The key reads "block agents from
 * loading skills", and the skills a group's members author are exactly the ones
 * their agents would load — so authoring, sharing, and editor grants are gated
 * with execution rather than left as a side door that fills the workspace with
 * skills the group may not run.
 */
export const skillOperations = {
  list: defineWorkspaceOperation({
    id: 'skills.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'skills.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  listAvailable: defineWorkspaceOperation({
    id: 'skills.list_available',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'skills.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'skills.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'skills.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  create: defineWorkspaceOperation({
    id: 'skills.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'skills.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'skills.update',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'skills.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  /**
   * One mixed batch of creates and updates applied as a single unit.
   *
   * The declared minimum role is the floor a pure-update batch needs, matching
   * {@link skillOperations.update}: workspace write is not required to edit a
   * skill you are an editor of. A batch that also creates is additionally
   * authorized against {@link skillOperations.create} by the use case, before
   * anything is written — so neither half of the batch is authorized more
   * loosely than it would be on its own.
   */
  upsert: defineWorkspaceOperation({
    id: 'skills.upsert',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'skills.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'skills.delete',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'skills.use',
    ...HUMAN_PRINCIPAL_POLICY,
  }),
  listEditors: defineWorkspaceOperation({
    id: 'skills.editors.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'skills.use',
    ...HTTP_SKILL_EDITOR_READ_POLICY,
  }),
  grantEditor: defineWorkspaceOperation({
    id: 'skills.editors.grant',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'skills.use',
    ...HUMAN_HTTP_SKILL_EDITOR_POLICY,
  }),
  revokeEditor: defineWorkspaceOperation({
    id: 'skills.editors.revoke',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'skills.use',
    ...HUMAN_HTTP_SKILL_EDITOR_POLICY,
  }),
} as const

export type SkillOperation = (typeof skillOperations)[keyof typeof skillOperations]
