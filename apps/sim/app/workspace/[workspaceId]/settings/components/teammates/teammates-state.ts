export type TeammatesDataState = 'loading' | 'error' | 'ready'

export interface TeammatesQueryState {
  permissionsError: boolean
  invitationsError: boolean
  workspacesError: boolean
  permissionConfigError: boolean
  permissionsLoading: boolean
  permissionsPlaceholder: boolean
  invitationsLoading: boolean
  invitationsPlaceholder: boolean
  workspacesLoading: boolean
  workspacesPlaceholder: boolean
  permissionConfigLoading: boolean
}

export function resolveTeammatesDataState(state: TeammatesQueryState): TeammatesDataState {
  if (
    state.permissionsError ||
    state.invitationsError ||
    state.workspacesError ||
    state.permissionConfigError
  ) {
    return 'error'
  }
  if (
    state.permissionsLoading ||
    state.permissionsPlaceholder ||
    state.invitationsLoading ||
    state.invitationsPlaceholder ||
    state.workspacesLoading ||
    state.workspacesPlaceholder ||
    state.permissionConfigLoading
  ) {
    return 'loading'
  }
  return 'ready'
}
