/** Held by every principal in the workspace; the default ACL of an upload. */
export const WORKSPACE_ACCESS_TOKEN = 'ws' as const

/** Held by every principal; a document the source itself makes public. */
export const PUBLIC_ACCESS_TOKEN = 'pub' as const

/**
 * The token set of a caller with no person behind it — a workspace API key, a
 * scheduled or webhook run, chat, MCP — and the base every person's set
 * extends. Sorted, like every ACL, so array comparisons are meaningful.
 */
export const WORKSPACE_ACCESS_TOKENS = [PUBLIC_ACCESS_TOKEN, WORKSPACE_ACCESS_TOKEN] as const

export interface WorkspaceAccessScope {
  kind: 'workspace'
  tokens: typeof WORKSPACE_ACCESS_TOKENS
}

export interface UserAccessScope {
  kind: 'user'
  userId: string
  /** `pub`, `ws`, and one `s:` token per active managed credential the person holds here. */
  tokens: readonly string[]
}

/**
 * What the calling principal may read, expressed as the tokens it holds. Every
 * document loader takes one; there is no way to read a document without it.
 */
export type KnowledgeAccessScope = WorkspaceAccessScope | UserAccessScope

/**
 * Lazily resolves the scope for one authorized operation. Created by the
 * knowledge context resolvers and attached to the use-case context, so a
 * write-only operation never pays for the membership lookup and a read
 * resolves it exactly once.
 */
export interface KnowledgeAccessProvider {
  get(): Promise<KnowledgeAccessScope>
}
