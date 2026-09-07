/** Held by every principal in the workspace; the default ACL of an upload. */
export const WORKSPACE_ACCESS_TOKEN = 'ws' as const

/** Held by current organization members only, within the canonical organization index. */
export const ORGANIZATION_ACCESS_TOKENS = ['org', 'pub'] as const

/** Held by every principal; a document the source itself makes public. */
export const PUBLIC_ACCESS_TOKEN = 'pub' as const

/**
 * Held by nobody. The ACL of a document the source shares only with whoever
 * has its link — reachable by anyone holding the URL, findable by no one.
 *
 * It is a token rather than an empty ACL so the distinction survives: a
 * document nobody may read and a document the source deliberately hid from
 * search are different facts, and only the second is worth explaining to an
 * admin wondering why a file they can open does not appear.
 */
export const LINK_ACCESS_TOKEN = 'link' as const

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
  /**
   * `pub`, `ws`, one `s:` token per active managed credential the person holds
   * here, their own `u:` token, and one `g:` token per mirrored directory group
   * they belong to.
   */
  tokens: readonly string[]
}

/**
 * What the calling principal may read, expressed as the tokens it holds. Every
 * document loader takes one; there is no way to read a document without it.
 */
export type KnowledgeAccessScope = WorkspaceAccessScope | UserAccessScope

/** Source permissions: the indexed OR clause, optionally narrowed by additional OR clauses. */
export interface SourceDocumentAcl {
  acl: readonly string[]
  requirements: readonly (readonly string[])[]
}

/** Simple sources need only an OR token list; hierarchical sources retain every required clause. */
export type MirroredDocumentAcl = readonly string[] | SourceDocumentAcl

/**
 * Lazily resolves the scope for one authorized operation. Created by the
 * knowledge context resolvers and attached to the use-case context, so a
 * write-only operation never pays for the membership lookup and a read
 * resolves it exactly once.
 */
export interface KnowledgeAccessProvider {
  get(): Promise<KnowledgeAccessScope>
}

declare const systemAccessScopeBrand: unique symbol

/**
 * The one exemption from access filtering: a background job acting on rows it
 * owns (document processing, connector sync). It is a branded type so it cannot
 * be assembled from a literal, and this module is its only source, so every
 * caller is one grep away. Never construct it on a request path.
 */
export interface SystemAccessScope {
  readonly kind: 'system'
  readonly [systemAccessScopeBrand]: true
}

export const SYSTEM_ACCESS_SCOPE: SystemAccessScope = Object.freeze({
  kind: 'system',
}) as SystemAccessScope
