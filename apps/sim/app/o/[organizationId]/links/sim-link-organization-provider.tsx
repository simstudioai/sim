'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import { suggestSimLinkName } from '@/lib/sim-links/validation'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'

interface SimLinkDraft {
  url: string
  title: string
}

interface SimLinkScope {
  organizationId: string | null
  /** Opens the new-link form for `url`, with a name suggested from `title`. */
  openForm: (url: string, title: string) => void
}

const SimLinkScopeContext = createContext<SimLinkScope>({
  organizationId: null,
  openForm: () => {},
})

interface SimLinkOrganizationProviderProps {
  /** Where `sim/<name>` resolves for this session, or null when it resolves nowhere. */
  organizationId: string | null
  children: ReactNode
}

/**
 * Scopes Sim link shortcuts to the organization whose links `sim/` opens for the viewer, and hosts
 * the new-link form at the layout root. A form opened from a menu row inside a popover would
 * otherwise render beneath it, since popovers stack above modals so they can open inside one; at
 * the root the form takes focus outside the popover, which dismisses it.
 */
export function SimLinkOrganizationProvider({
  organizationId,
  children,
}: SimLinkOrganizationProviderProps) {
  const [draft, setDraft] = useState<SimLinkDraft | null>(null)
  return (
    <SimLinkScopeContext.Provider
      value={{ organizationId, openForm: (url, title) => setDraft({ url, title }) }}
    >
      {children}
      {draft && organizationId && (
        <SimLinkModal
          organizationId={organizationId}
          initialUrl={draft.url}
          initialName={suggestSimLinkName(draft.title)}
          onClose={() => setDraft(null)}
        />
      )}
    </SimLinkScopeContext.Provider>
  )
}

/** The organization a new or copied Sim link belongs to; null hides every Sim link shortcut. */
export function useSimLinkOrganizationId(): string | null {
  return useContext(SimLinkScopeContext).organizationId
}

/** Opens the layout-hosted new-link form. */
export function useOpenSimLinkForm(): SimLinkScope['openForm'] {
  return useContext(SimLinkScopeContext).openForm
}
