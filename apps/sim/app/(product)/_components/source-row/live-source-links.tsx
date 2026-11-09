'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import { LinkEditor } from '@/app/(product)/_components/links-page/link-editor'
import {
  SourceActionsMenu,
  type SourceActionsProps,
  SourceActionsProvider,
} from '@/app/(product)/_components/source-row/source-row'
import { type LinkDraft, useSourceLinkAction } from '@/platform/lib/data/links'
import { useOrganization } from '@/platform/lib/data/organization'

const OpenEditor = createContext<((draft: LinkDraft) => void) | null>(null)

function useOpenEditor() {
  const openEditor = useContext(OpenEditor)
  if (!openEditor) throw new Error('A source row’s Sim link needs LiveSourceLinks')
  return openEditor
}

function SourceLinkActions({ row, actions, onLeave }: SourceActionsProps) {
  const { organization } = useOrganization()
  const openEditor = useOpenEditor()
  const [open, setOpen] = useState(false)
  const link = useSourceLinkAction(organization.id, row, open, (draft) => {
    onLeave?.()
    openEditor(draft)
  })
  return (
    <SourceActionsMenu
      row={row}
      actions={link ? [...actions, link] : actions}
      open={open}
      onOpenChange={setOpen}
    />
  )
}

/**
 * Adds the Sim link entry to every source row when the organization has Sim links, and hosts the
 * new-link form here, outside any popover holding the row, so the form is never beneath it.
 */
export function LiveSourceLinks({ children }: { children: ReactNode }) {
  const { organization, navFlags } = useOrganization()
  const [draft, setDraft] = useState<LinkDraft | null>(null)
  return (
    <OpenEditor.Provider value={setDraft}>
      <SourceActionsProvider value={navFlags.simLinks ? SourceLinkActions : null}>
        {children}
      </SourceActionsProvider>
      {draft && (
        <LinkEditor
          organizationId={organization.id}
          initialName={draft.name}
          initialUrl={draft.url}
          onClose={() => setDraft(null)}
        />
      )}
    </OpenEditor.Provider>
  )
}
