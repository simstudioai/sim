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
 * Whether a segment names a section at all is decided here too, before the shell renders, so a
 * bad or legacy URL loaded directly answers 404 or 307 without running section authorization.
 * Whether the *viewer* may open a section is a different question and stays in the page, where it
 * belongs; those checks need the database and are reached almost entirely by client navigation.
 *
 * There is deliberately no sibling `loading.tsx`, and the page renders its body under no Suspense
 * boundary of its own. React holds content that resolves inside a freshly committed fallback for
 * at least 300ms, so any boundary mounted with the section — a route fallback, or a page-level
 * `<Suspense>` around the code-split body — put that floor under every section switch. Without
 * one, a switch is a transition: the sidebar moves its selection and the settings layout paints
 * the incoming heading over the outgoing section, which stays mounted but invisible until the
 * incoming section and its chunk are ready. A boundary above this layout (a
 * `settings/loading.tsx`, or a `<Suspense>` in the settings layout) would also swallow the 404
 * and 307 above.
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
