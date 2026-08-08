/**
 * Lives in this standalone module — like {@link file://./pinned-item-keys.ts} and
 * {@link file://./folder-keys.ts} — so the sidebar's server prefetch can hydrate the
 * viewer's pending invitations without importing `@/hooks/queries/invitations`, which
 * pulls the emcn toast surface and the whole invitation-mutation machinery in with it.
 */

export const invitationKeys = {
  all: ['invitations'] as const,
  lists: () => [...invitationKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...invitationKeys.lists(), workspaceId] as const,
  details: () => [...invitationKeys.all, 'detail'] as const,
  /**
   * Scoped by viewer: the response is viewer-dependent (the join preview is
   * invitee-only, and authorization differs per account), so a cached entry
   * must never be reused across a sign-out/sign-in on the same invite link —
   * doing so would let a stale "nothing moves" preview become the disclosure
   * basis for a different user.
   */
  detail: (invitationId: string, token: string | null, viewerId: string | null) =>
    [...invitationKeys.details(), invitationId, token ?? '', viewerId ?? ''] as const,
  viewer: () => [...invitationKeys.all, 'viewer'] as const,
}

export const WORKSPACE_INVITATION_LIST_STALE_TIME = 30 * 1000
export const INVITATION_DETAILS_STALE_TIME = 30 * 1000

/** Shared with the server prefetch so a hydrated list and a client fetch never disagree. */
export const VIEWER_INVITATIONS_STALE_TIME = 30 * 1000
