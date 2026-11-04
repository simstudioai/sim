'use client'

import { type ReactNode, useState } from 'react'
import { Chip, DropdownMenuItem, toast, useCopyToClipboard } from '@sim/emcn'
import { Check, Link, Plus } from '@sim/emcn/icons'
import { simLinkUrl } from '@/lib/navigation/paths'
import { suggestSimLinkName } from '@/lib/sim-links/validation'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'
import { useOptionalOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useOptionalFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useSimLinksForUrl } from '@/hooks/queries/sim-links'

/**
 * The organization a Sim link made on this surface belongs to: the organization being viewed, or
 * the one that owns the current workspace. Null where Sim links are off, so the action is hidden.
 */
function useSimLinkOrganizationId(): string | null {
  const enabled = useOptionalFeatureFlag('sim-links')
  const organization = useOptionalOrganizationContext()
  const host = useOptionalWorkspaceHostContext()
  if (!enabled) return null
  return organization?.organization.id ?? host?.hostOrganizationId ?? null
}

interface SimLinkCreator {
  /** Null where Sim links are off; render no shortcut then. */
  organizationId: string | null
  openCreate: () => void
  /** The new-link form while it is open; render it outside any menu, which unmounts on close. */
  modal: ReactNode
}

/** Opens the new-link form for `url`, prefilled with a name suggested from `title`. */
export function useSimLinkCreator(url: string, title: string): SimLinkCreator {
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
  const { data, isPending } = useSimLinksForUrl(organizationId, url)
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })
  const existing = data?.at(0)
  const copyExisting = async () => {
    if (!existing) return false
    const done = await copy(simLinkUrl(window.location.origin, existing.name))
    if (!done) toast.error('Unable to copy Sim link')
    return done
  }
  return { existing, isPending, copied, copyExisting }
}

interface SimLinkShortcutProps {
  organizationId: string
  url: string
  onCreate: () => void
}

/**
 * The Sim link entry of an actions menu: copies the link that already opens this address, so a
 * menu never offers a duplicate, or offers to create one. It looks up when the menu opens.
 */
export function SimLinkMenuItem({ organizationId, url, onCreate }: SimLinkShortcutProps) {
  const { existing, isPending, copyExisting } = useExistingSimLink(organizationId, url)
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
      Create Sim link
    </DropdownMenuItem>
  )
}

function ShortcutChip({ organizationId, url, onCreate }: SimLinkShortcutProps) {
  const { existing, isPending, copied, copyExisting } = useExistingSimLink(organizationId, url)
  if (existing) {
    return (
      <Chip leftIcon={copied ? Check : Link} onClick={() => void copyExisting()}>
        {copied ? 'Copied!' : `Copy sim/${existing.name}`}
      </Chip>
    )
  }
  return (
    <Chip leftIcon={Plus} disabled={isPending} onClick={onCreate}>
      Create Sim link
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
  const { organizationId, openCreate, modal } = useSimLinkCreator(url, title)
  if (!organizationId) return null
  return (
    <>
      <ShortcutChip organizationId={organizationId} url={url} onCreate={openCreate} />
      {modal}
    </>
  )
}
