import { vi } from 'vitest'

/** Project membership locks for isolated workspace resource tests. */
export const projectMembershipMock = {
  lockWorkspaceProject: vi.fn(async () => null),
}
