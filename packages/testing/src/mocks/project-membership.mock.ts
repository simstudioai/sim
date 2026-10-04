import { vi } from 'vitest'

/** Project membership locks for isolated workspace resource tests. */
export const projectMembershipMock = {
  lockProject: vi.fn(async (): Promise<void> => {}),
  lockWorkspaceProject: vi.fn(async () => null),
}
