import { describe, expect, it } from 'vitest'
import { resolveTeammatesDataState, type TeammatesQueryState } from './teammates-state'

const readyState = {
  permissionsError: false,
  invitationsError: false,
  workspacesError: false,
  permissionConfigError: false,
  permissionsLoading: false,
  permissionsPlaceholder: false,
  invitationsLoading: false,
  invitationsPlaceholder: false,
  workspacesLoading: false,
  workspacesPlaceholder: false,
  permissionConfigLoading: false,
} satisfies TeammatesQueryState

describe('resolveTeammatesDataState', () => {
  it('reports loading while any required boundary is unresolved', () => {
    expect(resolveTeammatesDataState({ ...readyState, invitationsPlaceholder: true })).toBe(
      'loading'
    )
  })

  it('gives errors priority over loading and placeholder data', () => {
    expect(
      resolveTeammatesDataState({
        ...readyState,
        permissionConfigError: true,
        permissionsLoading: true,
        workspacesPlaceholder: true,
      })
    ).toBe('error')
  })

  it('reports ready only after every required boundary resolves', () => {
    expect(resolveTeammatesDataState(readyState)).toBe('ready')
  })
})
