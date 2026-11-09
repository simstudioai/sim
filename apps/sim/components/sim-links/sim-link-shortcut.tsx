'use client'

import { DropdownMenuItem, toast, useCopyToClipboard } from '@sim/emcn-legacy'
import { Link, Plus } from '@sim/emcn-legacy/icons'
import { simLinkUrl } from '@/lib/navigation/paths'
import { useSimLinksForUrl } from '@/hooks/queries/sim-links'

/** The first link that already opens `url`, and a copy of its address. */
function useExistingSimLink(organizationId: string, url: string, enabled = true) {
  const { data, isPending, isError } = useSimLinksForUrl(organizationId, url, enabled)
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })
  const existing = data?.at(0)
  const copyExisting = async () => {
    if (!existing) return false
    const done = await copy(simLinkUrl(window.location.origin, existing.name))
    if (!done) toast.error('Unable to copy link')
    return done
  }
  return { existing, isPending, isError, copied, copyExisting }
}

interface SimLinkShortcutProps {
  organizationId: string
  url: string
  onCreate: () => void
}

/**
 * The Sim link entry of an actions menu: copies the link that already opens this address, so a
 * menu never offers a duplicate, or offers to create one. It looks up when the menu opens, and
 * offers nothing when the lookup fails rather than risk a duplicate.
 */
export function SimLinkMenuItem({ organizationId, url, onCreate }: SimLinkShortcutProps) {
  const { existing, isPending, isError, copyExisting } = useExistingSimLink(organizationId, url)
  if (isError) return null
  if (existing) {
    return (
      <DropdownMenuItem
        onSelect={async () => {
          if (await copyExisting()) toast.success(`Copied sim/${existing.name}`)
        }}
      >
        <Link className='size-[14px]' />
        Copy sim/{existing.name}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenuItem disabled={isPending} onSelect={onCreate}>
      <Plus className='size-[14px]' />
      Create link
    </DropdownMenuItem>
  )
}
