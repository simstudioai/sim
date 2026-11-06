export type DocsSection = 'docs' | 'api' | 'cli' | 'mcp'

export interface DocsHeading {
  id: string
  title: string
  depth: number
}

export interface OperationReference {
  specFile: string
  method: string
  path: string
  operationId: string
  operation: Record<string, unknown>
}

/** A canonical document shared by HTML, Markdown, search, JSON, and MCP. */
export interface DocsPage {
  id: string
  url: string
  slugs: string[]
  title: string
  description: string
  section: DocsSection
  sourcePath: string
  headings: DocsHeading[]
  markdown: string
  contentHash: string
  lastModified?: string
  integration?: { type: string; color: string }
  operation?: OperationReference
}

/** Navigation carries display metadata only; document bodies remain on the server. */
export interface NavNode {
  id: string
  kind: 'page' | 'group' | 'label'
  title: string
  url?: string
  method?: string
  children?: NavNode[]
  defaultOpen?: boolean
}

export interface NavigationMeta {
  title?: string
  pages?: string[]
  labels?: Record<string, string>
  root?: boolean
  defaultOpen?: boolean
}

export interface ContentCatalog {
  version: 1
  pages: DocsPage[]
  navigation: Record<DocsSection, NavNode[]>
}
