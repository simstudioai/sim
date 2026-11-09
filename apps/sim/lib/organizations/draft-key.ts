/**
 * The key a viewer's unsent text on an organization surface is stored under. `slot` names what the
 * text belongs to, such as a chat id or a surface like `search`. Saved drafts live under these keys,
 * so their shape is persisted state: changing it strands what people have typed.
 */
export function organizationDraftKey(
  userId: string | undefined,
  organizationId: string,
  slot: string,
  { namespace }: { namespace?: string } = {}
): string {
  return `${namespace ? `${namespace}:` : ''}${userId}:organization:${organizationId}:${slot}`
}

/** The slot Search's Assistant keeps its unsent question under. */
export const SEARCH_ASSISTANT_DRAFT_SLOT = 'search-assistant'
