import { notFound, redirect } from 'next/navigation'
import {
  SettingsHeaderProvider,
  SettingsHeaderShell,
} from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { resolveSettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

/**
 * Legacy settings sections kept as redirects so old links and bookmarks still work.
 */
const TOP_LEVEL_REDIRECTS: Readonly<Record<string, (workspaceId: string) => string>> = {
  integrations: (workspaceId) => `/workspace/${workspaceId}/integrations`,
  skills: (workspaceId) => `/workspace/${workspaceId}/skills`,
  /** Cookie preferences moved into General. */
  privacy: (workspaceId) => `/workspace/${workspaceId}/settings/general?view=privacy`,
  'authorized-apps': (workspaceId) =>
    `/workspace/${workspaceId}/settings/general?view=authorized-apps`,
}

/**
 * Persistent chrome for the settings panel pages: the header bar, title, description, scroll
 * region and centered column. Scoped to `[section]` so detail routes (e.g.
 * `secrets/[credentialId]`) keep their own chrome.
 *
 * The heading is resolved here rather than pushed up from the section body, so it renders with
 * the shell instead of waiting on the body's lazily-loaded chunk.
 *
 * Whether a segment names a section at all is decided here too, above the sibling
 * `loading.tsx`. Inside that Suspense boundary a `notFound()` or `redirect()` can no longer set
 * the response status — React replays the boundary on the client and the shell still flushes
 * 200 — so a bad or legacy URL loaded directly would answer 200 and redirect in a second round
 * trip. Deciding it above the boundary keeps the 404 and the 307. Whether the *viewer* may open
 * a section is a different question and stays in the page, where it belongs; those checks need
 * the database and are reached almost entirely by client navigation.
 *
 * Authentication is already enforced by the ancestor workspace layout, so this runs only for a
 * signed-in viewer.
 */
export default async function SettingsSectionLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string; section: string }>
}) {
  const { workspaceId, section } = await params

  const topLevelHref = TOP_LEVEL_REDIRECTS[section]?.(workspaceId)
  if (topLevelHref) redirect(topLevelHref)

  const resolved = resolveSettingsSection(section)
  if (!resolved) notFound()

  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={resolved.meta}>{children}</SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
