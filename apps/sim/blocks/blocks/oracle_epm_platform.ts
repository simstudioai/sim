import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type {
  OracleEpmPlatformOperation,
  OracleEpmPlatformResponse,
} from '@/tools/oracle_epm_platform/types'

const USER_OPERATIONS = [
  'oracle_epm_platform_create_users',
  'oracle_epm_platform_update_users',
  'oracle_epm_platform_delete_users',
  'oracle_epm_platform_add_users_to_group',
  'oracle_epm_platform_remove_users_from_group',
  'oracle_epm_platform_assign_role',
  'oracle_epm_platform_unassign_role',
]
const GROUP_OPERATIONS = ['oracle_epm_platform_create_groups', 'oracle_epm_platform_delete_groups']

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Provide a boolean value')
}
function optionalText(value: unknown): unknown {
  return value === '' || value === null ? undefined : value
}
function parseArray(value: unknown, label: string): unknown[] {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${label} must be a JSON array`)
    }
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`)
  return parsed
}

export const OracleEpmPlatformBlock: BlockConfig<
  OracleEpmPlatformResponse<OracleEpmPlatformOperation>
> = {
  type: 'oracle_epm_platform',
  name: 'Oracle EPM Platform',
  description: 'Administer EPM environments, access, repository files, and migrations',
  longDescription:
    'Use common Oracle EPM administration APIs with a reusable Basic-auth service-account credential. Manage users, groups, roles, security settings, maintenance, repository files, snapshots, and administrative jobs. Operation availability varies by EPM product. Identity-domain user changes affect all environments in that domain. Downloaded output is limited to 100 MiB.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_platform',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle EPM Platform',
    sentences: {
      byOperation: {
        oracle_epm_platform_get_environment_info: ['Get Environment Info'],
        oracle_epm_platform_get_idle_session_timeout: ['Get Idle Session Timeout'],
        oracle_epm_platform_set_idle_session_timeout: [
          {
            text: 'Set idle timeout to',
            field: 'timeoutMinutes',
            core: true,
          },
          'minutes',
        ],
        oracle_epm_platform_set_maintenance_window: [
          {
            text: 'Set daily maintenance to',
            field: 'startTime',
            core: true,
          },
        ],
        oracle_epm_platform_run_daily_maintenance: ['Run daily maintenance now'],
        oracle_epm_platform_get_restricted_data_access: ['Get Restricted Data Access'],
        oracle_epm_platform_set_restricted_data_access: [
          {
            text: 'Set snapshot-submission restriction to',
            field: 'enabled',
            core: true,
          },
        ],
        oracle_epm_platform_get_upload_virus_scan: ['Get Upload Virus Scan'],
        oracle_epm_platform_set_upload_virus_scan: [
          {
            text: 'Set upload virus scanning to',
            field: 'enabled',
            core: true,
          },
        ],
        oracle_epm_platform_list_users: ['List Users'],
        oracle_epm_platform_create_users: ['Create identity-domain users'],
        oracle_epm_platform_update_users: ['Update identity-domain users'],
        oracle_epm_platform_delete_users: ['Delete identity-domain users'],
        oracle_epm_platform_list_groups: ['List Groups'],
        oracle_epm_platform_create_groups: ['Create Groups'],
        oracle_epm_platform_delete_groups: ['Delete Groups'],
        oracle_epm_platform_add_users_to_group: [
          {
            text: 'Add users to',
            field: ['groupnameSelector', 'groupnameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_remove_users_from_group: [
          {
            text: 'Remove users from',
            field: ['groupnameSelector', 'groupnameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_list_roles: ['List Roles'],
        oracle_epm_platform_assign_role: [
          {
            text: 'Assign role',
            field: ['rolenameSelector', 'rolenameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_unassign_role: [
          {
            text: 'Unassign role',
            field: ['rolenameSelector', 'rolenameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_get_role_assignments: ['Get Role Assignments'],
        oracle_epm_platform_get_user_group_report: ['Get User Group Report'],
        oracle_epm_platform_list_files: ['List Files'],
        oracle_epm_platform_delete_file: [
          {
            text: 'Delete repository file',
            field: ['fileNameSelector', 'fileNameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_upload_repository_file: [
          {
            text: 'Upload',
            field: ['repositoryFileUpload', 'repositoryFileReference'],
            core: true,
          },
          {
            text: 'as',
            field: 'uploadFileName',
            core: true,
          },
        ],
        oracle_epm_platform_download_file: [
          {
            text: 'Download up to 100 MiB from',
            field: ['fileNameSelector', 'fileNameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_get_snapshot: [
          {
            text: 'Inspect snapshot',
            field: ['snapshotNameSelector', 'snapshotNameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_export_snapshot: [
          {
            text: 'Repeat export of snapshot',
            field: ['snapshotNameSelector', 'snapshotNameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_import_snapshot: [
          {
            text: 'Import snapshot',
            field: ['snapshotNameSelector', 'snapshotNameManual'],
            core: true,
          },
        ],
        oracle_epm_platform_rename_snapshot: [
          {
            text: 'Rename snapshot',
            field: ['snapshotNameSelector', 'snapshotNameManual'],
            core: true,
          },
          {
            text: 'to',
            field: 'newSnapshotName',
            core: true,
          },
        ],
        oracle_epm_platform_list_migrations: ['List Migrations'],
        oracle_epm_platform_upload_snapshot: [
          {
            text: 'Upload snapshot',
            field: ['snapshotFileUpload', 'snapshotFileReference'],
            core: true,
          },
          {
            text: 'as',
            field: 'uploadSnapshotName',
            core: true,
          },
        ],
        oracle_epm_platform_get_admin_job_status: [
          {
            text: 'Check',
            field: 'jobKind',
            core: true,
          },
          {
            text: 'job',
            field: 'jobId',
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle EPM Account',
      type: 'oauth-input',
      serviceId: 'oracle-epm-platform',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle EPM credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle EPM Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      value: () => 'oracle_epm_platform_get_environment_info',
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          label: 'Get Environment Info',
          id: 'oracle_epm_platform_get_environment_info',
        },
        {
          label: 'Get Idle Session Timeout',
          id: 'oracle_epm_platform_get_idle_session_timeout',
        },
        {
          label: 'Set Idle Session Timeout',
          id: 'oracle_epm_platform_set_idle_session_timeout',
        },
        {
          label: 'Set Maintenance Window',
          id: 'oracle_epm_platform_set_maintenance_window',
        },
        {
          label: 'Run Daily Maintenance',
          id: 'oracle_epm_platform_run_daily_maintenance',
        },
        {
          label: 'Get Restricted Data Access',
          id: 'oracle_epm_platform_get_restricted_data_access',
        },
        {
          label: 'Set Restricted Data Access',
          id: 'oracle_epm_platform_set_restricted_data_access',
        },
        {
          label: 'Get Upload Virus Scan',
          id: 'oracle_epm_platform_get_upload_virus_scan',
        },
        {
          label: 'Set Upload Virus Scan',
          id: 'oracle_epm_platform_set_upload_virus_scan',
        },
        {
          label: 'List Users',
          id: 'oracle_epm_platform_list_users',
        },
        {
          label: 'Create Users',
          id: 'oracle_epm_platform_create_users',
        },
        {
          label: 'Update Users',
          id: 'oracle_epm_platform_update_users',
        },
        {
          label: 'Delete Users',
          id: 'oracle_epm_platform_delete_users',
        },
        {
          label: 'List Groups',
          id: 'oracle_epm_platform_list_groups',
        },
        {
          label: 'Create Groups',
          id: 'oracle_epm_platform_create_groups',
        },
        {
          label: 'Delete Groups',
          id: 'oracle_epm_platform_delete_groups',
        },
        {
          label: 'Add Users to Group',
          id: 'oracle_epm_platform_add_users_to_group',
        },
        {
          label: 'Remove Users from Group',
          id: 'oracle_epm_platform_remove_users_from_group',
        },
        {
          label: 'List Roles',
          id: 'oracle_epm_platform_list_roles',
        },
        {
          label: 'Assign Role',
          id: 'oracle_epm_platform_assign_role',
        },
        {
          label: 'Unassign Role',
          id: 'oracle_epm_platform_unassign_role',
        },
        {
          label: 'Get Role Assignments',
          id: 'oracle_epm_platform_get_role_assignments',
        },
        {
          label: 'Get User Group Report',
          id: 'oracle_epm_platform_get_user_group_report',
        },
        {
          label: 'List Files',
          id: 'oracle_epm_platform_list_files',
        },
        {
          label: 'Delete File',
          id: 'oracle_epm_platform_delete_file',
        },
        {
          label: 'Upload Repository File',
          id: 'oracle_epm_platform_upload_repository_file',
        },
        {
          label: 'Download File',
          id: 'oracle_epm_platform_download_file',
        },
        {
          label: 'Get Snapshot',
          id: 'oracle_epm_platform_get_snapshot',
        },
        {
          label: 'Export Snapshot',
          id: 'oracle_epm_platform_export_snapshot',
        },
        {
          label: 'Import Snapshot',
          id: 'oracle_epm_platform_import_snapshot',
        },
        {
          label: 'Rename Snapshot',
          id: 'oracle_epm_platform_rename_snapshot',
        },
        {
          label: 'List Migrations',
          id: 'oracle_epm_platform_list_migrations',
        },
        {
          label: 'Upload Snapshot',
          id: 'oracle_epm_platform_upload_snapshot',
        },
        {
          label: 'Get Admin Job Status',
          id: 'oracle_epm_platform_get_admin_job_status',
        },
      ],
      required: true,
    },
    {
      id: 'fileNameSelector',
      title: 'Repository File',
      type: 'project-selector',
      canonicalParamId: 'fileName',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_delete_file', 'oracle_epm_platform_download_file'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_platform_delete_file', 'oracle_epm_platform_download_file'],
      },
      placeholder: 'Select repository file (bounded list)',
      serviceId: 'oracle-epm-platform',
      selectorKey: 'oracle_epm_platform.files',
      dependsOn: ['credential', 'manualCredential'],
    },
    {
      id: 'fileNameManual',
      title: 'Repository File',
      type: 'short-input',
      canonicalParamId: 'fileName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_delete_file', 'oracle_epm_platform_download_file'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_platform_delete_file', 'oracle_epm_platform_download_file'],
      },
      placeholder: 'Enter exact name or reference',
    },
    {
      id: 'snapshotNameSelector',
      title: 'Snapshot',
      type: 'project-selector',
      canonicalParamId: 'snapshotName',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_get_snapshot',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_rename_snapshot',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_platform_get_snapshot',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_rename_snapshot',
        ],
      },
      placeholder: 'Select snapshot (bounded list)',
      serviceId: 'oracle-epm-platform',
      selectorKey: 'oracle_epm_platform.snapshots',
      dependsOn: ['credential', 'manualCredential'],
    },
    {
      id: 'snapshotNameManual',
      title: 'Snapshot',
      type: 'short-input',
      canonicalParamId: 'snapshotName',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_get_snapshot',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_rename_snapshot',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_platform_get_snapshot',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_rename_snapshot',
        ],
      },
      placeholder: 'Enter exact name or reference',
    },
    {
      id: 'groupnameSelector',
      title: 'Group',
      type: 'project-selector',
      canonicalParamId: 'groupname',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_get_user_group_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
        ],
      },
      placeholder: 'Select group (bounded list)',
      serviceId: 'oracle-epm-platform',
      selectorKey: 'oracle_epm_platform.groups',
      dependsOn: ['credential', 'manualCredential'],
    },
    {
      id: 'groupnameManual',
      title: 'Group',
      type: 'short-input',
      canonicalParamId: 'groupname',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_get_user_group_report',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
        ],
      },
      placeholder: 'Enter exact name or reference',
    },
    {
      id: 'rolenameSelector',
      title: 'Role',
      type: 'project-selector',
      canonicalParamId: 'rolename',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
          'oracle_epm_platform_get_role_assignments',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_platform_assign_role', 'oracle_epm_platform_unassign_role'],
      },
      placeholder: 'Select role (bounded list)',
      serviceId: 'oracle-epm-platform',
      selectorKey: 'oracle_epm_platform.roles',
      dependsOn: ['credential', 'manualCredential'],
    },
    {
      id: 'rolenameManual',
      title: 'Role',
      type: 'short-input',
      canonicalParamId: 'rolename',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
          'oracle_epm_platform_get_role_assignments',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_platform_assign_role', 'oracle_epm_platform_unassign_role'],
      },
      placeholder: 'Enter exact name or reference',
    },
    {
      id: 'repositoryFileUpload',
      title: 'Repository Source File',
      type: 'file-upload',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_repository_file'],
      },
      canonicalParamId: 'repositoryFile',
      mode: 'basic',
      multiple: false,
      maxSize: 100,
      required: true,
      placeholder: 'Upload a file up to 100 MiB',
    },
    {
      id: 'repositoryFileReference',
      title: 'Repository Source File',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_repository_file'],
      },
      canonicalParamId: 'repositoryFile',
      mode: 'advanced',
      required: true,
      placeholder: 'Reference a canonical UserFile',
    },
    {
      id: 'snapshotFileUpload',
      title: 'Snapshot ZIP File',
      type: 'file-upload',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_snapshot'],
      },
      canonicalParamId: 'snapshotFile',
      mode: 'basic',
      multiple: false,
      maxSize: 5120,
      required: true,
      placeholder: 'Upload a ZIP up to 5 GiB',
      acceptedTypes: '.zip',
    },
    {
      id: 'snapshotFileReference',
      title: 'Snapshot ZIP File',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_snapshot'],
      },
      canonicalParamId: 'snapshotFile',
      mode: 'advanced',
      required: true,
      placeholder: 'Reference a canonical UserFile',
    },
    {
      id: 'uploadFileName',
      title: 'New Repository File Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_repository_file'],
      },
      placeholder: 'data.csv (existing names are not overwritten)',
      required: true,
    },
    {
      id: 'directory',
      title: 'Repository Directory',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_repository_file'],
      },
      placeholder: 'Optional inbox, outbox, or supported subdirectory',
      mode: 'advanced',
    },
    {
      id: 'uploadSnapshotName',
      title: 'New Snapshot ZIP Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_snapshot'],
      },
      placeholder: 'backup.zip (existing names are not overwritten)',
      required: true,
    },
    {
      id: 'newSnapshotName',
      title: 'New Snapshot Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_rename_snapshot'],
      },
      placeholder: 'Renamed snapshot',
      required: true,
    },
    {
      id: 'timeoutMinutes',
      title: 'Idle Timeout (Minutes)',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_set_idle_session_timeout'],
      },
      placeholder: '30 (15–480 minutes)',
      required: true,
    },
    {
      id: 'startTime',
      title: 'Maintenance Start Time',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_set_maintenance_window'],
      },
      placeholder: '19:00 America/Los_Angeles',
      required: true,
    },
    {
      defaultValue: false,
      id: 'skipNext',
      title: 'Skip Next Scheduled Maintenance',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_run_daily_maintenance'],
      },
      mode: 'advanced',
    },
    {
      defaultValue: false,
      id: 'enabled',
      title: 'Enable Setting',
      type: 'switch',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_set_restricted_data_access',
          'oracle_epm_platform_set_upload_virus_scan',
        ],
      },
      required: true,
    },
    {
      id: 'users',
      title: 'Users (JSON)',
      type: 'long-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_create_users',
          'oracle_epm_platform_update_users',
          'oracle_epm_platform_delete_users',
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
        ],
      },
      placeholder:
        'Operator-provided JSON array; for password-bearing batches prefer a secret reference',
      required: true,
      rows: 5,
    },
    {
      id: 'groups',
      title: 'Groups (JSON)',
      type: 'long-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_create_groups', 'oracle_epm_platform_delete_groups'],
      },
      placeholder: '[{"groupname":"Finance"}]',
      required: true,
      rows: 4,
    },
    {
      id: 'userlogin',
      title: 'User Login Filter',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_list_users',
          'oracle_epm_platform_get_role_assignments',
          'oracle_epm_platform_get_user_group_report',
        ],
      },
      placeholder: 'Optional user login',
    },
    {
      id: 'userattribute',
      title: 'User Attribute Filter',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_list_users',
          'oracle_epm_platform_get_role_assignments',
          'oracle_epm_platform_get_user_group_report',
        ],
      },
      placeholder: 'Match login, first name, last name, or email',
      mode: 'advanced',
    },
    {
      id: 'groupFilter',
      title: 'Group Name Filter',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_groups'],
      },
      placeholder: 'Optional group name',
    },
    {
      id: 'epmgroups',
      title: 'Include EPM Groups',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_users'],
      },
      mode: 'advanced',
    },
    {
      id: 'idcsgroups',
      title: 'Include IDCS Groups',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_users'],
      },
      mode: 'advanced',
    },
    {
      id: 'granularroles',
      title: 'Include Granular Roles',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_users'],
      },
      mode: 'advanced',
    },
    {
      id: 'applicationroles',
      title: 'Include Application Roles',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_users'],
      },
      mode: 'advanced',
    },
    {
      id: 'indirect',
      title: 'Include Indirect Associations',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_users'],
      },
      mode: 'advanced',
    },
    {
      id: 'members',
      title: 'Include Group Members',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_groups'],
      },
      mode: 'advanced',
    },
    {
      id: 'roles',
      title: 'Include Group Roles',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_groups'],
      },
      mode: 'advanced',
    },
    {
      value: () => 'all',
      id: 'roleType',
      title: 'Role Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_roles'],
      },
      options: [
        {
          id: 'all',
          label: 'All Roles',
        },
        {
          id: 'application',
          label: 'Application',
        },
        {
          id: 'granular',
          label: 'Granular',
        },
      ],
      mode: 'advanced',
    },
    {
      defaultValue: false,
      id: 'importUsers',
      title: 'Import Identity-domain Users and Roles',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_import_snapshot'],
      },
    },
    {
      id: 'userPassword',
      title: 'Imported Users Password',
      type: 'short-input',
      password: true,
      placeholder: 'Optional secret reference; omit for unique temporary passwords',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_import_snapshot'],
        and: {
          field: 'importUsers',
          value: true,
        },
      },
    },
    {
      defaultValue: true,
      id: 'resetPassword',
      title: 'Require Password Reset at First Login',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_import_snapshot'],
        and: {
          field: 'importUsers',
          value: true,
        },
      },
    },
    {
      id: 'jobId',
      title: 'Admin Job ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_get_admin_job_status'],
      },
      placeholder: 'Exact jobId returned by a starter',
      required: true,
    },
    {
      value: () => 'migration',
      id: 'jobKind',
      title: 'Admin Job Kind',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_get_admin_job_status'],
      },
      required: true,
      options: [
        {
          id: 'migration',
          label: 'Migration',
        },
        {
          id: 'maintenance',
          label: 'Maintenance',
        },
        {
          id: 'snapshot_upload',
          label: 'Snapshot Upload',
        },
      ],
    },
    {
      defaultValue: false,
      id: 'waitForCompletion',
      title: 'Wait for Completion',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_get_admin_job_status'],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'oracle_epm_platform_get_environment_info',
      'oracle_epm_platform_get_idle_session_timeout',
      'oracle_epm_platform_set_idle_session_timeout',
      'oracle_epm_platform_set_maintenance_window',
      'oracle_epm_platform_run_daily_maintenance',
      'oracle_epm_platform_get_restricted_data_access',
      'oracle_epm_platform_set_restricted_data_access',
      'oracle_epm_platform_get_upload_virus_scan',
      'oracle_epm_platform_set_upload_virus_scan',
      'oracle_epm_platform_list_users',
      'oracle_epm_platform_create_users',
      'oracle_epm_platform_update_users',
      'oracle_epm_platform_delete_users',
      'oracle_epm_platform_list_groups',
      'oracle_epm_platform_create_groups',
      'oracle_epm_platform_delete_groups',
      'oracle_epm_platform_add_users_to_group',
      'oracle_epm_platform_remove_users_from_group',
      'oracle_epm_platform_list_roles',
      'oracle_epm_platform_assign_role',
      'oracle_epm_platform_unassign_role',
      'oracle_epm_platform_get_role_assignments',
      'oracle_epm_platform_get_user_group_report',
      'oracle_epm_platform_list_files',
      'oracle_epm_platform_delete_file',
      'oracle_epm_platform_upload_repository_file',
      'oracle_epm_platform_download_file',
      'oracle_epm_platform_get_snapshot',
      'oracle_epm_platform_export_snapshot',
      'oracle_epm_platform_import_snapshot',
      'oracle_epm_platform_rename_snapshot',
      'oracle_epm_platform_list_migrations',
      'oracle_epm_platform_upload_snapshot',
      'oracle_epm_platform_get_admin_job_status',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const {
          operation,
          repositoryFile,
          snapshotFile,
          uploadFileName,
          uploadSnapshotName,
          groupFilter,
          roleType,
          ...rest
        } = params
        if (typeof operation !== 'string') return {}
        const importingUsers =
          operation === 'oracle_epm_platform_import_snapshot' &&
          optionalBoolean(rest.importUsers) === true
        return {
          ...rest,
          users: USER_OPERATIONS.includes(operation) ? parseArray(rest.users, 'Users') : undefined,
          groups: GROUP_OPERATIONS.includes(operation)
            ? parseArray(rest.groups, 'Groups')
            : undefined,
          file:
            operation === 'oracle_epm_platform_upload_repository_file'
              ? normalizeFileInput(repositoryFile, { single: true })
              : operation === 'oracle_epm_platform_upload_snapshot'
                ? normalizeFileInput(snapshotFile, { single: true })
                : undefined,
          fileName:
            operation === 'oracle_epm_platform_upload_repository_file'
              ? uploadFileName
              : rest.fileName,
          snapshotName:
            operation === 'oracle_epm_platform_upload_snapshot'
              ? uploadSnapshotName
              : rest.snapshotName,
          groupname: optionalText(
            operation === 'oracle_epm_platform_list_groups' ? groupFilter : rest.groupname
          ),
          rolename: optionalText(rest.rolename),
          userlogin: optionalText(rest.userlogin),
          userattribute: optionalText(rest.userattribute),
          directory: optionalText(rest.directory),
          type: roleType === 'all' ? undefined : optionalText(roleType),
          timeoutMinutes:
            operation === 'oracle_epm_platform_set_idle_session_timeout'
              ? parseOptionalNumberInput(rest.timeoutMinutes, 'Idle timeout', {
                  integer: true,
                  min: 15,
                  max: 480,
                })
              : undefined,
          enabled: optionalBoolean(rest.enabled),
          skipNext: optionalBoolean(rest.skipNext),
          epmgroups: optionalBoolean(rest.epmgroups),
          idcsgroups: optionalBoolean(rest.idcsgroups),
          granularroles: optionalBoolean(rest.granularroles),
          applicationroles: optionalBoolean(rest.applicationroles),
          indirect: optionalBoolean(rest.indirect),
          members: optionalBoolean(rest.members),
          roles: optionalBoolean(rest.roles),
          importUsers: optionalBoolean(rest.importUsers),
          userPassword: importingUsers ? optionalText(rest.userPassword) : undefined,
          resetPassword: importingUsers ? (optionalBoolean(rest.resetPassword) ?? true) : undefined,
          waitForCompletion: optionalBoolean(rest.waitForCompletion),
        }
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Oracle EPM Platform operation',
    },
    oauthCredential: {
      type: 'string',
      description: 'Oracle EPM reusable service-account credential',
    },
    timeoutMinutes: {
      type: 'number',
      description: 'Idle timeout in minutes, integer from 15 to 480',
    },
    startTime: {
      type: 'string',
      description:
        'Start time from 00:00 through 23:59 (HH:MM), optionally followed by a space and a standard time zone such as 14:35 America/Los_Angeles',
    },
    skipNext: {
      type: 'boolean',
      description: 'Skip the next scheduled daily maintenance; defaults to false',
    },
    enabled: {
      type: 'boolean',
      description: 'Enable virus scanning on uploaded files',
    },
    userlogin: {
      type: 'string',
      description: 'Optional matching user login',
    },
    userattribute: {
      type: 'string',
      description: 'Match login, first name, last name, or email (case-insensitive)',
    },
    epmgroups: {
      type: 'boolean',
      description: 'Include EPM groups',
    },
    idcsgroups: {
      type: 'boolean',
      description: 'Include IDCS groups',
    },
    granularroles: {
      type: 'boolean',
      description: 'Include granular roles',
    },
    applicationroles: {
      type: 'boolean',
      description: 'Include application roles',
    },
    indirect: {
      type: 'boolean',
      description: 'Include indirect as well as direct associations',
    },
    users: {
      type: 'array',
      description:
        'Users to process (1–1,000); inspect failed and failedItems for partial failures',
    },
    groupname: {
      type: 'string',
      description: 'Optional group name filter',
    },
    members: {
      type: 'boolean',
      description: 'Include group and user members',
    },
    roles: {
      type: 'boolean',
      description: 'Include assigned granular roles',
    },
    groups: {
      type: 'array',
      description: 'Existing EPM groups to delete',
    },
    rolename: {
      type: 'string',
      description: 'Optional application or granular role name filter',
    },
    fileName: {
      type: 'string',
      description: 'Exact existing repository file or snapshot name',
    },
    directory: {
      type: 'string',
      description:
        'Optional supported destination: inbox, outbox, profitinbox, profitoutbox, a subdirectory of these, or Narrative Reporting to_be_imported',
    },
    snapshotName: {
      type: 'string',
      description: 'Existing Migration snapshot name',
    },
    importUsers: {
      type: 'boolean',
      description: 'Import identity-domain users and application roles; defaults to false',
    },
    userPassword: {
      type: 'string',
      description:
        'Optional operator-controlled password for imported users; omit for unique temporary passwords',
    },
    resetPassword: {
      type: 'boolean',
      description:
        'Require imported users to reset passwords at first login; defaults to true when importing users',
    },
    newSnapshotName: {
      type: 'string',
      description: 'New snapshot name',
    },
    jobId: {
      type: 'string',
      description:
        'Exact jobId returned by a starter: an Oracle numeric ID or a tagged Sim repository-upload reference',
    },
    jobKind: {
      type: 'string',
      description: 'Job kind: migration, maintenance, or snapshot_upload',
    },
    waitForCompletion: {
      type: 'boolean',
      description: 'Wait for terminal status within bounded attempts/deadlines; defaults to false',
    },
    repositoryFile: {
      type: 'file',
      description: 'Repository upload source, at most 100 MiB',
    },
    snapshotFile: {
      type: 'file',
      description: 'Snapshot upload source, at most 5 GiB',
    },
    uploadFileName: {
      type: 'string',
      description: 'New repository destination name',
    },
    uploadSnapshotName: {
      type: 'string',
      description: 'New ZIP snapshot destination name',
    },
    groupFilter: {
      type: 'string',
      description: 'Optional group name filter',
    },
    roleType: {
      type: 'string',
      description: 'all, application, or granular',
    },
  },
  outputs: {
    status: {
      type: 'number',
      description: 'Oracle status, not HTTP status',
    },
    message: {
      type: 'string',
      description: 'Safe operation summary',
    },
    environments: {
      type: 'array',
      description: 'Build and maintenance settings',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_get_environment_info'],
      },
    },
    timeoutMinutes: {
      type: 'number',
      description: 'Idle timeout in minutes',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_get_idle_session_timeout'],
      },
    },
    enabled: {
      type: 'boolean',
      description: 'Current security setting',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_get_restricted_data_access',
          'oracle_epm_platform_get_upload_virus_scan',
        ],
      },
    },
    users: {
      type: 'array',
      description: 'Users and requested associations or memberships',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_users', 'oracle_epm_platform_get_user_group_report'],
      },
    },
    groups: {
      type: 'array',
      description: 'Available groups with requested expansions',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_groups'],
      },
    },
    roles: {
      type: 'array',
      description: 'Available product-specific roles',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_roles'],
      },
    },
    assignments: {
      type: 'array',
      description: 'Users and assigned roles',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_get_role_assignments'],
      },
    },
    files: {
      type: 'array',
      description: 'Repository files and snapshot sizes/timestamps',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_files'],
      },
    },
    snapshots: {
      type: 'array',
      description: 'Snapshot capabilities',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_get_snapshot'],
      },
    },
    migrations: {
      type: 'array',
      description: 'Migration history and report counts',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_list_migrations'],
      },
    },
    file: {
      type: 'file',
      description: 'Downloaded UserFile, at most 100 MiB',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_download_file'],
      },
    },
    cleanupComplete: {
      type: 'boolean',
      description: 'Temporary download cleanup result',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_download_file'],
      },
    },
    fileName: {
      type: 'string',
      description: 'Uploaded repository file name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_repository_file'],
      },
    },
    snapshotName: {
      type: 'string',
      description: 'Uploaded ZIP snapshot name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_platform_upload_snapshot'],
      },
    },
    bytesUploaded: {
      type: 'number',
      description: 'Verified uploaded byte count',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_upload_repository_file',
          'oracle_epm_platform_upload_snapshot',
        ],
      },
    },
    processed: {
      type: 'number',
      description: 'processed from the identity batch result',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_create_users',
          'oracle_epm_platform_update_users',
          'oracle_epm_platform_delete_users',
          'oracle_epm_platform_create_groups',
          'oracle_epm_platform_delete_groups',
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
        ],
      },
    },
    succeeded: {
      type: 'number',
      description: 'succeeded from the identity batch result',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_create_users',
          'oracle_epm_platform_update_users',
          'oracle_epm_platform_delete_users',
          'oracle_epm_platform_create_groups',
          'oracle_epm_platform_delete_groups',
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
        ],
      },
    },
    failed: {
      type: 'number',
      description: 'failed from the identity batch result',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_create_users',
          'oracle_epm_platform_update_users',
          'oracle_epm_platform_delete_users',
          'oracle_epm_platform_create_groups',
          'oracle_epm_platform_delete_groups',
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
        ],
      },
    },
    partialFailure: {
      type: 'boolean',
      description: 'partialFailure from the identity batch result',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_create_users',
          'oracle_epm_platform_update_users',
          'oracle_epm_platform_delete_users',
          'oracle_epm_platform_create_groups',
          'oracle_epm_platform_delete_groups',
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
        ],
      },
    },
    failedItems: {
      type: 'array',
      description: 'Failed item identifiers and error codes',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_create_users',
          'oracle_epm_platform_update_users',
          'oracle_epm_platform_delete_users',
          'oracle_epm_platform_create_groups',
          'oracle_epm_platform_delete_groups',
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
        ],
      },
    },
    errorCode: {
      type: 'string',
      description: 'errorCode from the identity batch result',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_create_users',
          'oracle_epm_platform_update_users',
          'oracle_epm_platform_delete_users',
          'oracle_epm_platform_create_groups',
          'oracle_epm_platform_delete_groups',
          'oracle_epm_platform_add_users_to_group',
          'oracle_epm_platform_remove_users_from_group',
          'oracle_epm_platform_assign_role',
          'oracle_epm_platform_unassign_role',
        ],
      },
    },
    jobId: {
      type: 'string',
      description: 'Serializable administrative job ID when asynchronous',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_run_daily_maintenance',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_upload_repository_file',
          'oracle_epm_platform_upload_snapshot',
          'oracle_epm_platform_get_admin_job_status',
        ],
      },
    },
    jobKind: {
      type: 'string',
      description: 'migration, maintenance, or snapshot_upload',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_run_daily_maintenance',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_upload_repository_file',
          'oracle_epm_platform_upload_snapshot',
          'oracle_epm_platform_get_admin_job_status',
        ],
      },
    },
    completed: {
      type: 'boolean',
      description: 'Processing ended; inspect status for success',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_run_daily_maintenance',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_upload_repository_file',
          'oracle_epm_platform_upload_snapshot',
          'oracle_epm_platform_get_admin_job_status',
        ],
      },
    },
    tasks: {
      type: 'array',
      description: 'Migration task summaries when available',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_platform_run_daily_maintenance',
          'oracle_epm_platform_export_snapshot',
          'oracle_epm_platform_import_snapshot',
          'oracle_epm_platform_upload_repository_file',
          'oracle_epm_platform_upload_snapshot',
          'oracle_epm_platform_get_admin_job_status',
        ],
      },
    },
  },
}

export const OracleEpmPlatformBlockMeta = {
  tags: ['identity', 'automation', 'monitoring'],
  url: 'https://www.oracle.com/performance-management/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Audit EPM environment settings',
      prompt:
        'Build a scheduled workflow that reads Oracle EPM build and maintenance information and idle-session timeout, then records changes in a table without changing environment settings.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review EPM access assignments',
      prompt:
        'Build a scheduled workflow that retrieves all-user role assignments and the user-group report, compares the results with an approved access list, and produces a human-reviewed access digest.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['security', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Onboard approved EPM users',
      prompt:
        'Build an operator-started workflow using an explicitly supplied user-only JSON payload to create identity-domain users, check every batch failure, and assign approved roles and group membership only to successful users.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Remove obsolete EPM group membership',
      prompt:
        'Create a workflow that compares an approved membership list with EPM groups and removes only explicitly approved memberships. Do not delete identity-domain accounts. Report failed items separately.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor EPM migration jobs',
      prompt:
        'Build a workflow that accepts a migration job ID, reads its status once by default, optionally waits within execution limits, and records task summaries and terminal failures.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Export and retrieve a small EPM snapshot',
      prompt:
        'Build an operator-started workflow that repeats an existing Migration export, monitors its migration job, and downloads the resulting snapshot only if it fits the strict 100 MiB output limit. Report oversize and cleanup failures clearly.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'data-export'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review EPM upload and feedback protections',
      prompt:
        'Build a scheduled read-only workflow that checks upload virus scanning and snapshot-submission restrictions through Provide Feedback, compares them with approved policy, and sends a security review summary.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['security', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'review-epm-environment-access',
      description:
        'Review user, role, and group access without modifying identity-domain accounts.',
      content:
        '# Review user, role, and group access without modifying identity-domain accounts.\n\n## Steps\n\nUse List Users, List Groups, Get Role Assignments, and Get User Group Report. Omit the single-user filter when current all-user role data is needed. Treat product-specific role names as returned values. Compare with approved access policy; do not infer authority to mutate accounts.\n\n## Source\n\n[Oracle REST reference](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_role_assignment_report_for_users.html)',
    },
    {
      name: 'manage-approved-epm-memberships',
      description: 'Apply approved group membership changes and report batch failures.',
      content:
        '# Apply approved group membership changes and report batch failures.\n\n## Steps\n\nRead the target group and approved user list. Use Add Users to Group or Remove Users from Group only for the approved difference. Inspect failed and failedItems even when status is 0. Do not retry a whole partially successful batch or substitute account deletion.\n\n## Source\n\n[Oracle REST reference](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_add_user_to_group_v2.html)',
    },
    {
      name: 'monitor-epm-administrative-jobs',
      description: 'Track administrative jobs with serializable IDs and bounded waiting.',
      content:
        '# Track administrative jobs with serializable IDs and bounded waiting.\n\n## Steps\n\nKeep jobId and jobKind from the starter. Use Get Admin Job Status with migration, maintenance, or snapshot_upload. Default to one read; enable bounded waiting only when useful. Status -1 is progress, 0 success, and positive values failure. Do not resubmit starters after uncertain network failures.\n\n## Source\n\n[Oracle REST reference](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_status_codes.html)',
    },
    {
      name: 'operate-approved-epm-migrations',
      description: 'Repeat existing exports and import reviewed snapshots.',
      content:
        '# Repeat existing exports and import reviewed snapshots.\n\n## Steps\n\nInspect the snapshot first. Export Snapshot repeats tenant-defined export settings; it does not define arbitrary artifact schemas. Import Snapshot modifies the environment. Import users only with explicit identity-domain approval and required privileges. Monitor the returned migration job and check failures.\n\n## Source\n\n[Oracle REST reference](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_export_v2.html)',
    },
    {
      name: 'transfer-chunked-epm-snapshots',
      description: "Upload large snapshots while respecting Sim's separate download limit.",
      content:
        "# Upload large snapshots while respecting Sim's separate download limit.\n\n## Steps\n\nUse a canonical authorized ZIP UserFile up to 5 GiB and a new snapshot name ending in .zip. Upload Snapshot sends sequential chunks up to 50 MiB. Existing names are not overwritten. Keep any extraction job ID. Downloads always stop at 100 MiB, even if the uploaded snapshot was larger.\n\n## Source\n\n[Oracle REST reference](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload_application_snapshot_parent.html)",
    },
    {
      name: 'audit-epm-feedback-and-upload-controls',
      description: 'Interpret specialized EPM feedback and virus-scanning controls correctly.',
      content:
        '# Interpret specialized EPM feedback and virus-scanning controls correctly.\n\n## Steps\n\nRead Restricted Data Access to check whether snapshots can be submitted through Provide Feedback; this is not generic application row-level security. Read Upload Virus Scan independently. Compare against approved policy and require explicit authorization before either setting is changed.\n\n## Source\n\n[Oracle REST reference](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_get_restricted_data_access.html)',
    },
  ],
} as const satisfies BlockMeta
