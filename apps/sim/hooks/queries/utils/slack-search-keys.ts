export const slackSearchKeys = {
  all: ['slack-search'] as const,
  lists: () => [...slackSearchKeys.all, 'list'] as const,
  list: (organizationId?: string) => [...slackSearchKeys.lists(), organizationId ?? ''] as const,
  manifests: () => [...slackSearchKeys.all, 'manifest'] as const,
  organizationManifests: (organizationId: string) =>
    [...slackSearchKeys.manifests(), organizationId] as const,
  manifest: (organizationId: string, name: string) =>
    [...slackSearchKeys.organizationManifests(organizationId), name] as const,
}
