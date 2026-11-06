export const DOCS_SECTIONS = [
  { slug: 'docs', label: 'Documentation', compactLabel: 'Docs', href: '/introduction' },
  {
    slug: 'api-reference',
    label: 'API reference',
    compactLabel: 'API reference',
    href: '/api-reference/getting-started',
  },
  { slug: 'cli', label: 'CLI', compactLabel: 'CLI', href: '/cli' },
  { slug: 'mcp', label: 'MCP', compactLabel: 'MCP', href: '/mcp/overview' },
] as const

/** Matches the first path segment so integration names cannot select a reference section. */
export function getDocsSection(pathname: string) {
  const segment = pathname.split('/')[1]
  return DOCS_SECTIONS.find((section) => section.slug === segment)?.slug ?? 'docs'
}
