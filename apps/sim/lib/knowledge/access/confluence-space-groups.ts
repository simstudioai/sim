/** Reserved for source audiences; native Confluence group ingestion rejects this namespace. */
export const CONFLUENCE_SPACE_GROUP_PREFIX = 'space-readers:'

export function isConfluenceSpaceGroupId(groupId: string): boolean {
  return /^space-readers:\d+$/.test(groupId)
}
