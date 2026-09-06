/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { PROVENANCE_MAX_ENTRIES } from '@/lib/execution/provenance-limits'
import {
  bindWorkspaceFileUploadProvenance,
  readWorkspaceFileUploadProvenance,
  WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY,
} from '@/lib/uploads/upload-session/workspace-file-provenance'

const entry = { encryptedValue: 'fixture-ciphertext', sourceUserId: 'reader' }
const bound = bindWorkspaceFileUploadProvenance('workspace', { status: 'exact', entries: [entry] })
const read = (binding: unknown) =>
  readWorkspaceFileUploadProvenance({
    workspaceId: 'workspace',
    metadata: { [WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]: binding },
  })

describe('private workspace-upload classification', () => {
  it('never treats pending transfer evidence as safe', () => {
    const pending = bindWorkspaceFileUploadProvenance('workspace', 'pending')
    expect(pending.pending).toBe(true)
    expect(read(pending)).toEqual({ status: 'unknown' })
    expect(read({ ...bound, pending: true })).toEqual({ status: 'unknown' })
  })
  it('preserves ordinary uploads without a private binding', () => {
    expect(
      readWorkspaceFileUploadProvenance({
        workspaceId: 'workspace',
        metadata: { folderId: 'folder' },
      })
    ).toBeUndefined()
  })
  it('retains encrypted classification after JSON persistence and a fresh read', () => {
    expect(read(JSON.parse(JSON.stringify(bound)))).toEqual({ status: 'exact', entries: [entry] })
  })
  it.each(['unknown', 'unrecorded'] as const)('does not relax an explicit %s status', (status) => {
    expect(read(bindWorkspaceFileUploadProvenance('workspace', { status }))).toEqual({ status })
  })
  it('keeps an explicitly safe runtime source usable', () => {
    expect(
      read(bindWorkspaceFileUploadProvenance('workspace', { status: 'exact', entries: [] }))
    ).toEqual({ status: 'exact', entries: [] })
  })
  it.each([
    null,
    { ...bound, version: 2 },
    { ...bound, workspaceId: 'other-workspace' },
    { ...bound, provenance: { status: 'future-status' } },
    { ...bound, provenance: { status: 'exact', entries: {} } },
    {
      ...bound,
      provenance: { status: 'exact', entries: [{ encryptedValue: 'fixture-ciphertext' }] },
    },
    { ...bound, provenance: { status: 'exact', entries: [{ ...entry, encryptedValue: '' }] } },
    {
      ...bound,
      provenance: { status: 'exact', entries: Array(PROVENANCE_MAX_ENTRIES + 1).fill(entry) },
    },
  ])('treats an unusable stored binding as unknown: %j', (binding) => {
    expect(read(binding)).toEqual({ status: 'unknown' })
  })
})
