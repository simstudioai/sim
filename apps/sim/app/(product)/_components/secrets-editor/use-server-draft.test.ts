import { describe, expect, it } from 'vitest'
import {
  mergeSecretsDraft,
  rebaseAfterSecretsSave,
  type SecretsDraft,
  sameSecretsDraft,
} from '@/app/(product)/_components/secrets-editor/secrets-draft'
import { serverDraftReducer } from '@/app/(product)/_components/secrets-editor/use-server-draft'

const row = (id: number, key: string, value: string) => ({ id, key, value })
const { reduce } = serverDraftReducer(sameSecretsDraft, mergeSecretsDraft)

function start(server: SecretsDraft) {
  return { draft: server, baseline: server, seen: server, incoming: null }
}

const server = { variables: { A: '1' }, rows: [row(1, '', '')] }

describe('the secrets draft buffer', () => {
  it('reverts every edit on Discard', () => {
    const edited = reduce(start(server), {
      type: 'edit',
      update: (current) => ({ variables: {}, rows: [row(2, 'NEW', 'n'), ...current.rows] }),
    })
    const reverted = reduce(edited, { type: 'take-latest' })
    expect(reverted.draft).toEqual(server)
  })

  it('holds a refetch back while edits are unsaved, instead of overwriting them', () => {
    const edited = reduce(start(server), {
      type: 'edit',
      update: (current) => ({ ...current, variables: { A: 'mine' } }),
    })
    const refetched = reduce(edited, {
      type: 'server',
      server: { variables: { A: 'theirs' }, rows: [row(9, '', '')] },
      dirty: true,
    })
    expect(refetched.draft.variables.A).toBe('mine')
    expect(refetched.incoming?.variables.A).toBe('theirs')
  })

  it('keeps the row being typed, by identity, when a refetch lands on a clean draft', () => {
    const refetched = reduce(start(server), {
      type: 'server',
      server: { variables: { A: '1', B: '2' }, rows: [row(9, '', '')] },
      dirty: false,
    })
    expect(refetched.draft.rows.map((entry) => entry.id)).toEqual([1])
    expect(refetched.draft.variables).toEqual({ A: '1', B: '2' })
  })

  it('rebases edits made while a save was in flight onto what the save wrote', () => {
    const submitted = { variables: { A: '1' }, rows: [row(2, 'NEW', 'n'), row(1, '', '')] }
    const saving = reduce(start(server), { type: 'edit', update: () => submitted })
    const typedDuringSave = reduce(saving, {
      type: 'edit',
      update: (current) => ({ ...current, variables: { A: 'typed during save' } }),
    })
    const saved = { A: '1', NEW: 'n' }
    const landed = reduce(typedDuringSave, {
      type: 'saved',
      saved: { variables: saved, rows: [] },
      rebase: (current) => rebaseAfterSecretsSave(submitted, current, saved),
    })
    expect(landed.draft.variables).toEqual({ A: 'typed during save', NEW: 'n' })
    expect(sameSecretsDraft(landed.draft, landed.baseline)).toBe(false)
  })
})
