'use client'

import { useMemo } from 'react'
import { Chip, TRIGGER_BORDER_CLASS } from '@sim/emcn'
import { Download } from '@sim/emcn/icons'
import { FileView } from '@/components/resources/file-view'
import { buildSharedByLabel } from '@/lib/public-shares/provenance'
import { Navbar } from '@/app/(landing)/components/navbar'
import { ShareLinkButton } from '@/app/(landing)/components/share-link-button'
import { useBrandConfig } from '@/ee/whitelabeling'
import { fileContentUrl, grantsForShare, shareSource } from '@/resources'

/** A share visitor reads the file and nothing else. */
const SHARE_GRANTS = grantsForShare('file')

interface PublicFileViewProps {
  token: string
  name: string
  type: string
  size: number
  /** Content version (the file's `updatedAt`, epoch ms) — busts the viewer's caches when the file changes. */
  version: number
  /** Display name of the share's owner, for the "Shared by" credit. */
  ownerName: string | null
}

export function PublicFileView({
  token,
  name,
  type,
  size,
  version,
  ownerName,
}: PublicFileViewProps) {
  const brand = useBrandConfig()

  /**
   * A file share exposes exactly one file, so the grant is the token itself. The
   * page already resolved and authorized the file's metadata, so it seeds the
   * view rather than making the anonymous visitor fetch a record they have no
   * endpoint for.
   */
  const source = useMemo(
    () => shareSource({ kind: 'file', token, grantId: token, seed: { name, type, size, version } }),
    [token, name, type, size, version]
  )
  /** The share's own bytes, from the source — links are never hand-built. */
  const contentUrl = fileContentUrl(source, '')

  /**
   * The root is the page's scroll port, exactly like the landing shell
   * (`overflow-y-auto` + `overscroll-y-none`): the document body never
   * overflows, so the sticky navbar cannot be rubber-banded past the edges,
   * and the navbar's frost sentinel observes this port — the bar frosts to
   * the same glass as the landing bar once content scrolls beneath it.
   * `h-dvh` (not `h-screen`) because iOS Safari's `100vh` overshoots by the
   * URL bar. `main` has no `min-h-0`, so flowing renderers (text/markdown)
   * grow the port and scroll under the bar, while `h-full` renderers
   * (PDF/CSV/media) keep the leftover height and scroll internally.
   */
  return (
    <div className='light flex h-dvh flex-col overflow-y-auto overscroll-y-none bg-[var(--bg)]'>
      <Navbar
        logoOnly
        name={name}
        meta={buildSharedByLabel(ownerName)}
        hideBrand={Boolean(brand.logoUrl)}
        actions={
          <>
            <Chip
              className={TRIGGER_BORDER_CLASS}
              leftIcon={Download}
              onClick={() => {
                const anchor = document.createElement('a')
                anchor.href = contentUrl
                anchor.download = name
                document.body.appendChild(anchor)
                anchor.click()
                anchor.remove()
              }}
            >
              Download
            </Chip>
            <ShareLinkButton title={name} kind='File' />
          </>
        }
      />

      <main className='flex flex-1 flex-col'>
        <FileView source={source} grants={SHARE_GRANTS} host='public' readOnly />
      </main>
    </div>
  )
}
