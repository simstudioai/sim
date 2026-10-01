/**
 * AEO/GEO-style posts (listicles, comparisons, how-tos) split out of `/blog`
 * into the dedicated `/library` section so `/blog` stays editorial-only.
 * `next.config.ts` redirects `/blog/<slug>` to `/library/<slug>` for each.
 */
export const LIBRARY_MOVED_BLOG_SLUGS = [
  'best-zapier-alternatives',
  'ai-agents-vs-rpa',
  'ai-agent-vs-chatbot',
  'openai-vs-n8n-vs-sim',
  'ai-agent-ideas',
  'how-to-create-an-ai-agent',
] as const

/**
 * Library articles retired by merging into a stronger article on the same
 * search intent, keyed by retired slug. `next.config.ts` redirects each
 * retired URL to the surviving article, and `check:library-content` rejects
 * new links to a retired slug.
 */
export const LIBRARY_MERGED_SLUGS: Readonly<Record<string, string>> = {
  'automation-anywhere-alternative': 'ai-agents-vs-rpa',
  'ai-native-vs-traditional-workflow-automation':
    'ai-native-workflow-automation-vs-traditional-automation',
  'best-ai-workflow-builders-small-teams-2026': 'best-ai-workflow-builders',
  'best-ai-agent-builder-2026': 'best-ai-agent-platforms-2026',
  'best-ai-agent-builders-slack-crm-automation-2026': 'best-ai-agents-for-slack',
  'best-open-source-ai-agent-frameworks': 'open-source-ai-agent-platforms',
}
