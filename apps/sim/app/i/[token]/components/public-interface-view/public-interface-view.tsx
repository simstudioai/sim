'use client'

import { useMemo } from 'react'
import { InterfaceView } from '@/components/resources/interface-view'
import { buildSharedByLabel } from '@/lib/public-shares/provenance'
import { Navbar } from '@/app/(landing)/components/navbar'
import { ShareLinkButton } from '@/app/(landing)/components/share-link-button'
import { useBrandConfig } from '@/ee/whitelabeling'
import { grantsForShare, type ResourceSeed, shareSource } from '@/resources'

/** An anonymous visitor never writes and never manages; the token routes run. */
const PUBLIC_INTERFACE_GRANTS = grantsForShare('interface')

export interface PublicInterfaceViewProps {
  token: string
  /**
   * Everything the server resolved and authorized before rendering: the
   * interface name, the layout already PRUNED to the modules a visitor can use,
   * and each of those modules' own resolved resource. The client never receives
   * a module it is not authorized to render, and never an id it could address.
   */
  seed: ResourceSeed<'interface'>
  /** Display name of the share's owner, for the "Shared by" credit. */
  ownerName: string | null
}

/**
 * A shared interface as a visitor sees it: the shared {@link Navbar} (Sim
 * wordmark + the interface's name) and the interface itself. No workspace
 * chrome, no account affordances — the page is the interface.
 *
 * The body is {@link InterfaceView}, the identical component the editor mounts,
 * given a `share` source and a `public` host: every module resolves its data
 * through token-scoped endpoints, links resolve to nothing, and no editor state
 * exists at all. Nothing about the modules is reimplemented for the public
 * surface, so the preview a builder sees is the page a visitor gets.
 *
 * Viewport-bounded (`h-dvh`, not `min-h-screen`) because the grid's tracks are
 * `minmax(0, 1fr)` and `height: 100%` only resolves against a definite-height
 * containing block — under a `min-h-*` ancestor the tracks collapse to content
 * height. `h-dvh` rather than `h-screen` because iOS Safari's `100vh` overshoots
 * by the URL bar and clips the bottom pane.
 */
export function PublicInterfaceView({ token, seed, ownerName }: PublicInterfaceViewProps) {
  const brand = useBrandConfig()

  /**
   * Built here rather than on the server: a source carries its copy and link
   * resolvers as functions, which cannot cross the RSC boundary. The seed is
   * the serializable half, and it is the half the server actually proved.
   */
  const source = useMemo(
    () => shareSource({ kind: 'interface', token, grantId: token, seed }),
    [token, seed]
  )

  return (
    <div className='light flex h-dvh flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]'>
      <Navbar
        logoOnly
        name={seed.name}
        meta={buildSharedByLabel(ownerName)}
        hideBrand={Boolean(brand.logoUrl)}
        actions={<ShareLinkButton title={seed.name} kind='Interface' />}
      />

      <main className='flex min-h-0 flex-1 flex-col'>
        <InterfaceView source={source} grants={PUBLIC_INTERFACE_GRANTS} host='public' />
      </main>
    </div>
  )
}
