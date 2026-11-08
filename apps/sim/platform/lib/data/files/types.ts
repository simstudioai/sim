import type { useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

/** A live workspace file, as its record query returns it. */
export type WorkspaceFileRecord = NonNullable<ReturnType<typeof useWorkspaceFileRecord>['data']>
