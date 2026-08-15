/**
 * Display names per remappable resource kind, in the two registers the console needs.
 *
 * `label` stands on its own — a table cell, a badge, a filter option. `phrase` reads inside a
 * sentence ("map it to an existing knowledge base"). They are declared together rather than
 * derived from one another because the difference is not mechanical: lowercasing "MCP server"
 * would be wrong, and title-casing "knowledge base" for a mid-sentence use would be too.
 */
const FORK_KIND_NAMES: Record<string, { label: string; phrase: string }> = {
  credential: { label: 'Credential', phrase: 'credential' },
  'env-var': { label: 'Secret', phrase: 'secret' },
  table: { label: 'Table', phrase: 'table' },
  'knowledge-base': { label: 'Knowledge base', phrase: 'knowledge base' },
  'knowledge-document': { label: 'Document', phrase: 'document' },
  file: { label: 'File', phrase: 'file' },
  'mcp-server': { label: 'MCP server', phrase: 'MCP server' },
  'custom-tool': { label: 'Custom tool', phrase: 'custom tool' },
  skill: { label: 'Skill', phrase: 'skill' },
}

/** Standalone name for a kind, falling back to the raw kind so a new one is still legible. */
export function forkKindLabel(kind: string): string {
  return FORK_KIND_NAMES[kind]?.label ?? kind
}

/** Mid-sentence name for a kind, falling back to the generic noun. */
export function forkKindPhrase(kind: string): string {
  return FORK_KIND_NAMES[kind]?.phrase ?? 'resource'
}
