const HIDDEN_INLINE_REFERENCE_PATTERN =
  /`[^`\n]*(?:internal\/tool-results\/|internal\/blocktips\/|components\/integrations\/[^`\n]*README)[^`\n]*`/g
const WORKSPACE_RESOURCE_CODE_SPAN_PATTERN =
  /`([^`\n]*<workspace_resource>[\s\S]*?<\/workspace_resource>[^`\n]*)`/g

export function sanitizeChatDisplayContent(content: string): string {
  return content
    .replace(WORKSPACE_RESOURCE_CODE_SPAN_PATTERN, '$1')
    .replace(HIDDEN_INLINE_REFERENCE_PATTERN, '')
    .replace(/`(\s*<workspace_resource>)/g, '$1')
    .replace(/(<\/workspace_resource>\s*)`/g, '$1')
}
