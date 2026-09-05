import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

/** Stored Basic-auth credential; its token and REST base URL are executor-injected. */
export interface OracleEpmPlatformAuth {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export type OracleEpmAdminJobKind = 'migration' | 'maintenance' | 'snapshot_upload'

export interface OracleEpmUserReference {
  userlogin: string
}
export interface OracleEpmGroupReference {
  groupname: string
}
export interface OracleEpmCreateUser extends OracleEpmUserReference {
  firstname?: string
  lastname: string
  email: string
  password?: string
  resetpassword: boolean
}
export interface OracleEpmUpdateUser extends OracleEpmUserReference {
  firstname?: string
  lastname?: string
  email?: string
}
export interface OracleEpmCreateGroup extends OracleEpmGroupReference {
  description?: string
  members?: {
    users?: OracleEpmUserReference[]
    groups?: OracleEpmGroupReference[]
  }
}
export interface OracleEpmUser {
  userlogin: string
  firstname: string
  lastname: string
  email: string
}
export interface OracleEpmGroupSummary {
  groupname: string
  description: string
  type: string
}
export interface OracleEpmAssignedRole {
  rolename: string
  id: string
}
export interface OracleEpmListedUser extends OracleEpmUser {
  epmgroups?: OracleEpmGroupSummary[]
  idcsgroups?: OracleEpmGroupSummary[]
  granularroles?: OracleEpmAssignedRole[]
  applicationroles?: OracleEpmAssignedRole[]
}
export interface OracleEpmGroup extends OracleEpmGroupSummary {
  identity: string
  members?: { users: OracleEpmUser[]; groups: OracleEpmGroupSummary[] }
  roles?: OracleEpmAssignedRole[]
}
export interface OracleEpmRole {
  name: string
  id: string
}
export interface OracleEpmRoleAssignment extends OracleEpmUser {
  roles: { rolename: string; roletype: string; grantedthroughgroup: string }[]
}
export interface OracleEpmUserGroups extends OracleEpmUser {
  groups: { groupname: string; direct: boolean }[]
}
export interface OracleEpmRepositoryFile {
  name: string
  type: 'LCM' | 'EXTERNAL'
  size: number | null
  lastModifiedTime: number | null
}
export interface OracleEpmSnapshot {
  name: string
  type: 'LCM' | 'EXTERNAL'
  canExport: boolean
  canImport: boolean
  canUpload: boolean
  canDownload: boolean
}
export interface OracleEpmMigration {
  action: string
  duration: string
  status: string
  user: string
  snapshot: string
  endTime: string
  startTime: string
  report: {
    destination: string
    source: string
    status: string
    errorCount: number
    warningCount: number
  }[]
}
export interface OracleEpmTask {
  name: string
  source: string
  destination: string
}
export interface OracleEpmStatus {
  /** Provider status, not HTTP status. Zero succeeds; minus one is asynchronous progress. */
  status: number
  /** Fixed, non-provider-authored failure summary; never echoes passwords or credentials. */
  message: string
}
export interface OracleEpmJob extends OracleEpmStatus {
  jobId?: string
  jobKind?: OracleEpmAdminJobKind
  completed: boolean
  tasks?: OracleEpmTask[]
}
export interface OracleEpmFailedItem {
  userlogin?: string
  groupname?: string
  errorcode: string
  erroritems?: {
    users?: { userlogin: string; errorcode: string }[]
    groups?: { groupname: string; errorcode: string }[]
  }
}
export interface OracleEpmBatchResult extends OracleEpmStatus {
  processed: number | null
  succeeded: number | null
  failed: number | null
  partialFailure: boolean
  failedItems: OracleEpmFailedItem[]
  errorCode: string | null
}

interface OracleEpmPlatformInputMap {
  get_environment_info: Record<never, never>
  get_idle_session_timeout: Record<never, never>
  set_idle_session_timeout: { timeoutMinutes: number }
  set_maintenance_window: { startTime: string }
  run_daily_maintenance: { skipNext?: boolean }
  get_restricted_data_access: Record<never, never>
  set_restricted_data_access: { enabled: boolean }
  get_upload_virus_scan: Record<never, never>
  set_upload_virus_scan: { enabled: boolean }
  list_users: {
    userlogin?: string
    userattribute?: string
    epmgroups?: boolean
    idcsgroups?: boolean
    granularroles?: boolean
    applicationroles?: boolean
    indirect?: boolean
  }
  create_users: { users: OracleEpmCreateUser[] }
  update_users: { users: OracleEpmUpdateUser[] }
  delete_users: { users: OracleEpmUserReference[] }
  list_groups: { groupname?: string; members?: boolean; roles?: boolean }
  create_groups: { groups: OracleEpmCreateGroup[] }
  delete_groups: { groups: OracleEpmGroupReference[] }
  add_users_to_group: { groupname: string; users: OracleEpmUserReference[] }
  remove_users_from_group: { groupname: string; users: OracleEpmUserReference[] }
  list_roles: { type?: 'application' | 'granular' }
  assign_role: { rolename: string; users: OracleEpmUserReference[] }
  unassign_role: { rolename: string; users: OracleEpmUserReference[] }
  get_role_assignments: { userlogin?: string; rolename?: string; userattribute?: string }
  get_user_group_report: { userlogin?: string; groupname?: string; userattribute?: string }
  list_files: Record<never, never>
  delete_file: { fileName: string }
  upload_repository_file: { file: UserFile; fileName: string; directory?: string }
  download_file: { fileName: string }
  get_snapshot: { snapshotName: string }
  export_snapshot: { snapshotName: string }
  import_snapshot: {
    snapshotName: string
    importUsers?: boolean
    userPassword?: string
    resetPassword?: boolean
  }
  rename_snapshot: { snapshotName: string; newSnapshotName: string }
  list_migrations: Record<never, never>
  upload_snapshot: { file: UserFile; snapshotName: string }
  get_admin_job_status: {
    jobId: string
    jobKind: OracleEpmAdminJobKind
    waitForCompletion?: boolean
  }
}

export interface OracleEpmPlatformOutputMap {
  get_environment_info: OracleEpmStatus & {
    environments: { buildVersion: string; maintenanceStartTime: string; timeZone?: string }[]
  }
  get_idle_session_timeout: OracleEpmStatus & { timeoutMinutes: number }
  set_idle_session_timeout: OracleEpmStatus
  set_maintenance_window: OracleEpmStatus
  run_daily_maintenance: OracleEpmJob
  get_restricted_data_access: OracleEpmStatus & { enabled: boolean }
  set_restricted_data_access: OracleEpmStatus
  get_upload_virus_scan: OracleEpmStatus & { enabled: boolean }
  set_upload_virus_scan: OracleEpmStatus
  list_users: OracleEpmStatus & { users: OracleEpmListedUser[] }
  create_users: OracleEpmBatchResult
  update_users: OracleEpmBatchResult
  delete_users: OracleEpmBatchResult
  list_groups: OracleEpmStatus & { groups: OracleEpmGroup[] }
  create_groups: OracleEpmBatchResult
  delete_groups: OracleEpmBatchResult
  add_users_to_group: OracleEpmBatchResult
  remove_users_from_group: OracleEpmBatchResult
  list_roles: OracleEpmStatus & { roles: OracleEpmRole[] }
  assign_role: OracleEpmBatchResult
  unassign_role: OracleEpmBatchResult
  get_role_assignments: OracleEpmStatus & { assignments: OracleEpmRoleAssignment[] }
  get_user_group_report: OracleEpmStatus & { users: OracleEpmUserGroups[] }
  list_files: OracleEpmStatus & { files: OracleEpmRepositoryFile[] }
  delete_file: OracleEpmStatus
  upload_repository_file: OracleEpmJob & { fileName: string; bytesUploaded: number }
  download_file: OracleEpmStatus & { file: UserFile; cleanupComplete: boolean }
  get_snapshot: OracleEpmStatus & { snapshots: OracleEpmSnapshot[] }
  export_snapshot: OracleEpmJob
  import_snapshot: OracleEpmJob
  rename_snapshot: OracleEpmStatus
  list_migrations: OracleEpmStatus & { migrations: OracleEpmMigration[] }
  upload_snapshot: OracleEpmJob & { snapshotName: string; bytesUploaded: number }
  get_admin_job_status: OracleEpmJob
}

export type OracleEpmPlatformOperation = keyof OracleEpmPlatformInputMap
export type OracleEpmPlatformParams<K extends OracleEpmPlatformOperation> = OracleEpmPlatformAuth &
  Omit<OracleEpmPlatformInputMap[K], never>
export interface OracleEpmPlatformResponse<K extends OracleEpmPlatformOperation>
  extends ToolResponse {
  output: OracleEpmPlatformOutputMap[K]
}

export const ORACLE_EPM_STATUS_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Oracle operation status: 0 completed, -1 in progress, positive values failed; not an HTTP status',
  },
  message: {
    type: 'string',
    description: 'Safe operation summary without provider error text or passwords',
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_EPM_JOB_OUTPUTS = {
  ...ORACLE_EPM_STATUS_OUTPUTS,
  jobId: {
    type: 'string',
    optional: true,
    description:
      'Serializable job ID for Get Admin Job Status; present when an asynchronous job is identified',
  },
  jobKind: {
    type: 'string',
    optional: true,
    description: 'migration, maintenance, or snapshot_upload; use together with jobId',
  },
  completed: {
    type: 'boolean',
    description: 'Whether processing ended; inspect status to distinguish success from failure',
  },
  tasks: {
    type: 'array',
    optional: true,
    description: 'Documented migration task summaries, when returned',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name' },
        source: { type: 'string', description: 'Source artifact or component' },
        destination: { type: 'string', description: 'Destination artifact or component' },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_EPM_BATCH_OUTPUTS = {
  ...ORACLE_EPM_STATUS_OUTPUTS,
  processed: {
    type: 'number',
    nullable: true,
    description: 'Records processed; null when Oracle rejects the entire request',
  },
  succeeded: {
    type: 'number',
    nullable: true,
    description: 'Records that succeeded; null when the entire request is rejected',
  },
  failed: {
    type: 'number',
    nullable: true,
    description: 'Records that failed; outer status 0 does not imply this is zero',
  },
  partialFailure: {
    type: 'boolean',
    description: 'Whether Oracle accepted the batch but reported item failures',
  },
  errorCode: {
    type: 'string',
    nullable: true,
    description: 'Oracle EPMCSS code for a whole-request failure',
  },
  failedItems: {
    type: 'array',
    description:
      'Failed item identifiers and error codes; password-bearing provider error messages are not returned',
    items: {
      type: 'object',
      properties: {
        userlogin: { type: 'string', optional: true, description: 'Failed user login' },
        groupname: { type: 'string', optional: true, description: 'Failed group name' },
        errorcode: { type: 'string', description: 'Oracle EPMCSS item error code' },
        erroritems: {
          type: 'object',
          optional: true,
          description: 'Nested Add Groups member failures when returned',
          properties: {
            users: {
              type: 'array',
              optional: true,
              items: {
                type: 'object',
                properties: {
                  userlogin: { type: 'string' },
                  errorcode: { type: 'string' },
                },
              },
            },
            groups: {
              type: 'array',
              optional: true,
              items: {
                type: 'object',
                properties: {
                  groupname: { type: 'string' },
                  errorcode: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_EPM_USER_PROPERTIES = {
  userlogin: { type: 'string', description: 'User login' },
  firstname: { type: 'string', description: 'First name; may be empty' },
  lastname: { type: 'string', description: 'Last name' },
  email: { type: 'string', description: 'Email address' },
} satisfies Record<string, ToolOutputProperty>
export const ORACLE_EPM_GROUP_SUMMARY_PROPERTIES = {
  groupname: { type: 'string', description: 'Group name' },
  description: { type: 'string', description: 'Group description' },
  type: { type: 'string', description: 'Provider group type, such as EPM, IDCS, or PREDEFINED' },
} satisfies Record<string, ToolOutputProperty>
export const ORACLE_EPM_ASSIGNED_ROLE_PROPERTIES = {
  rolename: { type: 'string', description: 'Product-specific role name' },
  id: { type: 'string', description: 'Role identifier' },
} satisfies Record<string, ToolOutputProperty>
