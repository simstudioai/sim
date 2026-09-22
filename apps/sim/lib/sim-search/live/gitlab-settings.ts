import type { ConnectorMeta } from '@/connectors/types'

/** Keep legacy indexing copy unchanged outside the live organization search screens. */
export function liveGitLabSearchMeta(
  meta: ConnectorMeta | null,
  enabled: boolean
): ConnectorMeta | null {
  if (!enabled || meta?.id !== 'gitlab') return meta
  const descriptions: Record<string, string> = {
    contentTypes:
      'Choose the content members can search in this project. Defaults to Wiki & Issues.',
    ref: 'Branch or tag for code search and file reads. Leave empty for the default branch.',
    pathPrefix: 'Only allow code under this directory. Other content types are unaffected.',
    fileExtensions: 'Only allow code files with these extensions. Separate extensions with commas.',
  }
  return {
    ...meta,
    configFields: meta.configFields
      .filter((field) => field.id !== 'maxItems')
      .map((field) =>
        descriptions[field.id] ? { ...field, description: descriptions[field.id] } : field
      ),
  }
}
