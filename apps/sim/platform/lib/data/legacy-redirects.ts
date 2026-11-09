import 'server-only'
import { notFound } from 'next/navigation'
import { followProductRoute, productLocation } from '@/platform/lib/data/route-resolution'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/**
 * The body of every page that serves a moved workspace URL: the route table answers it with a
 * permanent redirect to the page in the organization the workspace renders in, and a workspace the
 * viewer cannot open, or a path with no new home, is not found, so a private workspace's
 * organization never shows.
 */
export async function redirectLegacyWorkspaceUrl(
  workspaceId: string,
  segments: readonly string[],
  searchParams: Record<string, string | string[] | undefined>
): Promise<never> {
  const surface = await readOrganizationSurface()
  if (surface.status === 'ok') {
    const pathname = ['', 'workspace', workspaceId, ...segments].map(encodeURIComponent).join('/')
    await followProductRoute(surface.organization, productLocation(pathname, searchParams))
  }
  notFound()
}
