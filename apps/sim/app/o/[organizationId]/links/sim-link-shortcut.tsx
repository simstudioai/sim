'use client'

import { type ReactNode, useState } from 'react'
import { Chip, DropdownMenuItem, toast, useCopyToClipboard } from '@sim/emcn'
import { Check, Link, Plus } from '@sim/emcn/icons'
import { simLinkUrl } from '@/lib/navigation/paths'
import { suggestSimLinkName } from '@/lib/sim-links/validation'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'
import { useSimLinkOrganizationId } from '@/app/o/[organizationId]/links/sim-link-organization-provider'
import { useSimLinksForUrl } from '@/hooks/queries/sim-links'

interface SimLinkCreator {
  /** Null where Sim links are off; render no shortcut then. */
  organizationId: string | null
  openCreate: () => void
  /** The new-link form while it is open, rendered inside the dialog that opened it. */
  modal: ReactNode
}

/**
 * A new-link form nested in the dialog that opens it, so it stacks above that dialog and keeps its
 * focus trap. Menus and popovers use the layout-hosted form (`useOpenSimLinkForm`) instead.
 */
function useNestedSimLinkCreator(url: string, title: string): SimLinkCreator {
  const organizationId = useSimLinkOrganizationId()
  const [open, setOpen] = useState(false)
  return {
    organizationId,
    openCreate: () => setOpen(true),
    modal:
      open && organizationId ? (
        <SimLinkModal
          organizationId={organizationId}
          initialUrl={url}
          initialName={suggestSimLinkName(title)}
          onClose={() => setOpen(false)}
        />
      ) : null,
  }
}

/** The first link that already opens `url`, and a copy of its address. */
function useExistingSimLink(organizationId: string, url: string) {
  const { data, isPending, isError } = useSimLinksForUrl(organizationId, url)
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

function ShortcutChip({ organizationId, url, onCreate }: SimLinkShortcutProps) {
  const { existing, isPending, isError, copied, copyExisting } = useExistingSimLink(
    organizationId,
    url
  )
  if (isError) return null
  if (existing) {
    return (
      <Chip leftIcon={copied ? Check : Link} onClick={() => void copyExisting()}>
        {copied ? 'Copied!' : `Copy sim/${existing.name}`}
      </Chip>
    )
  }
  return (
    <Chip leftIcon={Plus} disabled={isPending} onClick={onCreate}>
      Create link
    </Chip>
  )
}

interface SimLinkChipProps {
  url: string
  /** The title a new link's name is suggested from. */
  title: string
}

/** The same choice as a footer chip, for a dialog that already shows the address it shortens. */
export function SimLinkChip({ url, title }: SimLinkChipProps) {
  const { organizationId, openCreate, modal } = useNestedSimLinkCreator(url, title)
  if (!organizationId) return null
  return (
    <>
      <ShortcutChip organizationId={organizationId} url={url} onCreate={openCreate} />
      {modal}
    </>
  )
}
