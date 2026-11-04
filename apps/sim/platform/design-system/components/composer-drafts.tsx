'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type { ComposerDraft } from '@/platform/design-system/models/conversation'

function useDraftState() {
  const [drafts, setDrafts] = useState(() => new Map<string, ComposerDraft>())
  function update(
    key: string,
    initial: ComposerDraft,
    edit: (draft: ComposerDraft) => ComposerDraft
  ) {
    setDrafts((previous) => new Map(previous).set(key, edit(previous.get(key) ?? initial)))
  }
  return { drafts, update }
}

const Drafts = createContext<ReturnType<typeof useDraftState> | null>(null)

export function ComposerDrafts({ children }: { children: ReactNode }) {
  const state = useDraftState()
  return <Drafts.Provider value={state}>{children}</Drafts.Provider>
}

export function useComposerDraft(key: string, initial: ComposerDraft) {
  const state = useContext(Drafts)
  if (!state) throw new Error('A message composer needs the product session')
  return [
    state.drafts.get(key) ?? initial,
    (edit: (draft: ComposerDraft) => ComposerDraft) => state.update(key, initial, edit),
  ] as const
}
