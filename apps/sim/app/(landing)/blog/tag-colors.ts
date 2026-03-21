export interface Category {
  id: string
  label: string
  color: string
}

export const CATEGORIES: Category[] = [
  { id: 'announcements', label: 'Announcements', color: '#FA4EDF' },
  { id: 'product', label: 'Product', color: '#00F701' },
  { id: 'engineering', label: 'Engineering', color: '#2ABBF8' },
  { id: 'design', label: 'Design', color: '#8B5CF6' },
  { id: 'insights', label: 'Insights', color: '#FFCC02' },
] as const

const TAG_TO_CATEGORY: Record<string, string> = {
  // Announcements — company news, funding, milestones
  Announcement: 'announcements',
  Funding: 'announcements',
  'Series A': 'announcements',
  YCombinator: 'announcements',

  // Product — releases, features, enterprise
  Release: 'product',
  Enterprise: 'product',
  Copilot: 'product',
  MCP: 'product',
  Integrations: 'product',
  Observability: 'product',
  Security: 'product',
  'Self-Hosted': 'product',
  SSO: 'product',
  SAML: 'product',
  Compliance: 'product',
  BYOK: 'product',
  'Access Control': 'product',
  Whitelabel: 'product',
  API: 'product',
  Import: 'product',
  Export: 'product',

  // Engineering — architecture, internals, deep dives
  Architecture: 'engineering',
  Executor: 'engineering',
  DAG: 'engineering',
  Orchestration: 'engineering',
  Multiplayer: 'engineering',
  Realtime: 'engineering',
  Collaboration: 'engineering',
  WebSockets: 'engineering',
  Benchmarks: 'engineering',
  'AI Assistant': 'engineering',

  // Design — UI/UX, design systems, components
  Design: 'design',
  Emcn: 'design',
  UI: 'design',
  UX: 'design',
  Components: 'design',

  // Insights — comparisons, analysis, thought leadership
  'AI Agents': 'insights',
  'Workflow Automation': 'insights',
  'OpenAI AgentKit': 'insights',
  n8n: 'insights',
}

export function getTagCategory(tag: string): string {
  return TAG_TO_CATEGORY[tag] ?? 'insights'
}

export function getCategoryById(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[4]
}

export function getPrimaryCategory(tags: string[]): Category {
  const matchedIds = new Set<string>()
  for (const tag of tags) {
    matchedIds.add(getTagCategory(tag))
  }

  for (const cat of CATEGORIES) {
    if (matchedIds.has(cat.id)) return cat
  }

  return CATEGORIES[4]
}

export function getTagColor(tag: string): string {
  const catId = getTagCategory(tag)
  return getCategoryById(catId).color
}
