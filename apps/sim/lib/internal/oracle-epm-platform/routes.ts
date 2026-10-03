import {
  oracleEpmLiteral,
  oracleEpmPathParameter,
  oracleEpmQuery,
} from '@/lib/internal/oracle-epm/endpoint'
import { defineOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type {
  OracleEpmEndpointDeclaration,
  OracleEpmRouteSpace,
} from '@/lib/internal/oracle-epm/types'

export const REPOSITORY_FILE_LIMIT = 100 * 1024 * 1024
export const SNAPSHOT_FILE_LIMIT = 5 * 1024 * 1024 * 1024
export const SNAPSHOT_CHUNK_LIMIT = 50 * 1024 * 1024
export const DOWNLOAD_FILE_LIMIT = 100 * 1024 * 1024
const JSON_LIMIT = 10 * 1024 * 1024

const interop = defineOracleEpmRouteSpace({
  context: ['interop', 'rest'],
  allowedVersions: ['11.1.2.3.600', 'v1', 'v2', 'v3'],
})
const security = defineOracleEpmRouteSpace({
  context: ['interop', 'rest', 'security'],
  allowedVersions: ['v1', 'v2'],
})
const filter = oracleEpmQuery.string({ maxBytes: 1024 })
const jobId = oracleEpmPathParameter('jobId', { maxBytes: 64, pattern: /^[0-9]+$/ })
const snapshotName = oracleEpmPathParameter('snapshotName', { maxBytes: 255 })
const fileName = oracleEpmPathParameter('fileName', { maxBytes: 255, mode: 'repository-path' })

/** Fixed source declarations only; no tool input can select a route, version, or method. */
function jsonEndpoint(
  space: OracleEpmRouteSpace,
  version: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query?: OracleEpmEndpointDeclaration['query']
) {
  return space.defineEndpoint({
    version,
    method,
    path: path.split('/').map(oracleEpmLiteral),
    query,
    body: method === 'GET' || method === 'DELETE' ? 'none' : 'json',
    response: 'json',
    timeoutMs: 30_000,
    ...(method === 'GET' || method === 'DELETE' ? {} : { maxRequestBytes: JSON_LIMIT }),
    maxResponseBytes: JSON_LIMIT,
    ...(method === 'GET'
      ? { retry: { maxAttempts: 2, statuses: [429, 503], initialDelayMs: 500, maxDelayMs: 2000 } }
      : {}),
  })
}

// Oracle endpoint references: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/
export const endpoints = {
  // lcm_get_build_version_and_maintenance_time_v2.html
  get_environment_info: jsonEndpoint(
    interop,
    'v2',
    'GET',
    'maintenance/getdailymaintenancestarttime',
    { showTimeZone: oracleEpmQuery.boolean() }
  ),
  // get_idle_session_timeout.html
  get_idle_session_timeout: jsonEndpoint(
    interop,
    'v2',
    'GET',
    'config/services/idlesessiontimeout'
  ),
  // set_idle_session_timeout.html
  set_idle_session_timeout: jsonEndpoint(
    interop,
    'v2',
    'PUT',
    'config/services/idlesessiontimeout'
  ),
  // lcm_update_maintenance_time_v2.html
  set_maintenance_window: jsonEndpoint(
    interop,
    'v2',
    'PUT',
    'maintenance/setdailymaintenancestarttime'
  ),
  // lcm_update_maintenance_time_skip_next1_v2.html
  run_daily_maintenance: jsonEndpoint(interop, 'v2', 'POST', 'maintenance/rundailymaintenance'),
  // lcm_get_restricted_data_access.html
  get_restricted_data_access: jsonEndpoint(
    interop,
    'v2',
    'GET',
    'config/services/restricteddataaccess'
  ),
  // lcm_set_restricted_data_access.html
  set_restricted_data_access: jsonEndpoint(
    interop,
    'v2',
    'PUT',
    'config/services/restricteddataaccess'
  ),
  // lcm_get_virus_scan_on_file_upload.html
  get_upload_virus_scan: jsonEndpoint(
    interop,
    'v2',
    'GET',
    'config/services/virusscanonfileupload'
  ),
  // lcm_set_virus_scan_on_file_upload.html
  set_upload_virus_scan: jsonEndpoint(
    interop,
    'v2',
    'PUT',
    'config/services/virusscanonfileupload'
  ),
  // lcm_list_users.html
  list_users: jsonEndpoint(security, 'v1', 'POST', 'users/list'),
  // lcm_add_user_to_identity_domain_v2.html
  create_users: jsonEndpoint(security, 'v2', 'POST', 'users/add'),
  // lcm_update_users_v2.html
  update_users: jsonEndpoint(security, 'v2', 'PUT', 'users/update'),
  // lcm_remove_user_from_identity_domain_v2.html
  delete_users: jsonEndpoint(security, 'v2', 'POST', 'users/remove'),
  // lcm_list_groups.html
  list_groups: jsonEndpoint(security, 'v1', 'POST', 'groups/list'),
  // lcm_add_a_batch_of_groups_v2.html
  create_groups: jsonEndpoint(security, 'v2', 'POST', 'groups/add'),
  // lcm_remove_a_batch_of_groups_v2.html
  delete_groups: jsonEndpoint(security, 'v2', 'POST', 'groups/remove'),
  // lcm_add_user_to_group_v2.html
  add_users_to_group: jsonEndpoint(security, 'v2', 'PUT', 'groups/adduserstogroup'),
  // lcm_remove_user_from_group_v2.html
  remove_users_from_group: jsonEndpoint(security, 'v2', 'PUT', 'groups/removeusersfromgroup'),
  // lcm_get_available_roles.html
  list_roles: jsonEndpoint(security, 'v2', 'GET', 'role/getavailableroles', {
    type: oracleEpmQuery.string({ maxBytes: 11, pattern: /^(application|granular)$/ }),
  }),
  // lcm_assign_role_v2.html
  assign_role: jsonEndpoint(security, 'v2', 'PUT', 'role/assign/user'),
  // lcm_unassign_role_v2.html
  unassign_role: jsonEndpoint(security, 'v2', 'PUT', 'role/unassign/user'),
  // lcm_role_assignment_report_for_users.html
  get_role_assignments: jsonEndpoint(security, 'v2', 'GET', 'report/roleassignmentreport/user', {
    userlogin: filter,
    rolename: filter,
    userattribute: filter,
  }),
  // lcm_user_group_report_v2.html
  get_user_group_report: jsonEndpoint(security, 'v2', 'GET', 'report/usergroupreport', {
    userlogin: filter,
    groupname: filter,
    userattribute: filter,
  }),
  // list_files_v2.html
  list_files: jsonEndpoint(interop, 'v2', 'GET', 'files/list'),
  // delete_files_v3.html
  delete_file: jsonEndpoint(interop, 'v3', 'POST', 'files/delete'),
  // lcm_export_v2.html
  export_snapshot: jsonEndpoint(interop, 'v2', 'POST', 'snapshots/export'),
  // lcm_import_v2.html
  import_snapshot: jsonEndpoint(interop, 'v2', 'POST', 'snapshots/import'),
  // lcm_rename_application_snapshot_v2.html
  rename_snapshot: jsonEndpoint(interop, 'v2', 'PUT', 'snapshots/rename'),
  // migration_generate_status_report.html
  list_migrations: jsonEndpoint(interop, 'v2', 'GET', 'migration/status'),
  // download_application_snapshot_v2.html
  download_file: jsonEndpoint(interop, 'v2', 'POST', 'files/download'),
  // get_information_about_a_specific_application_snapshot.html
  get_snapshot: interop.defineEndpoint({
    version: '11.1.2.3.600',
    method: 'GET',
    path: [oracleEpmLiteral('applicationsnapshots'), snapshotName],
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: JSON_LIMIT,
    retry: { maxAttempts: 2, statuses: [429, 503], initialDelayMs: 500, maxDelayMs: 2000 },
  }),
  // upload.html: the complete repository path is encoded as ONE path parameter.
  upload_repository_file: interop.defineEndpoint({
    version: '11.1.2.3.600',
    method: 'POST',
    path: [oracleEpmLiteral('applicationsnapshots'), fileName, oracleEpmLiteral('contents')],
    query: { extDirPath: oracleEpmQuery.string({ maxBytes: 1024 }) },
    body: 'stream',
    response: 'json',
    timeoutMs: 300_000,
    maxRequestBytes: REPOSITORY_FILE_LIMIT,
    maxResponseBytes: JSON_LIMIT,
  }),
  // upload_application_snapshot.html: empty init/finalize bodies and bounded binary chunks.
  upload_snapshot: interop.defineEndpoint({
    version: 'v1',
    method: 'POST',
    path: [oracleEpmLiteral('applicationsnapshots'), snapshotName, oracleEpmLiteral('contents')],
    query: { q: oracleEpmQuery.string({ required: true, maxBytes: 1024 }) },
    body: 'stream',
    response: 'json',
    timeoutMs: 300_000,
    maxRequestBytes: SNAPSHOT_CHUNK_LIMIT,
    maxResponseBytes: JSON_LIMIT,
  }),
} as const

function statusEndpoint(version: string, path: string) {
  return interop.defineEndpoint({
    version,
    method: 'GET',
    path: [...path.split('/').map(oracleEpmLiteral), jobId],
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: JSON_LIMIT,
    retry: { maxAttempts: 2, statuses: [429, 503], initialDelayMs: 500, maxDelayMs: 2000 },
  })
}

// Prefer the task tables' GET contract; contradictory POST links are rejected, not repaired.
// Oracle's legacy upload example addresses extraction by filename, not a v1 numeric job ID.
// appendix_postman_upload_snapshot.html and common_helper_functions_for_java.html
export const repositoryUploadStatusEndpoint = interop.defineEndpoint({
  version: '11.1.2.3.600',
  method: 'GET',
  path: [
    oracleEpmLiteral('applicationsnapshots'),
    fileName,
    oracleEpmLiteral('contents'),
    oracleEpmLiteral('status'),
  ],
  body: 'none',
  response: 'json',
  timeoutMs: 30_000,
  maxResponseBytes: JSON_LIMIT,
  retry: { maxAttempts: 2, statuses: [429, 503], initialDelayMs: 500, maxDelayMs: 2000 },
})
export const repositoryUploadStatusPolicy = interop.defineReturnedLinkPolicy({
  relation: 'Job Status',
  method: 'GET',
  endpoint: repositoryUploadStatusEndpoint,
  preserveGatewayBasePath: true,
})

export const jobEndpoints = {
  migration: statusEndpoint('v2', 'status/migration'),
  maintenance: statusEndpoint('v2', 'status/service/maintenancewindow'),
  snapshot_upload: statusEndpoint('v1', 'services/jobs'),
  download: statusEndpoint('v2', 'status/download'),
} as const

export const jobLinkPolicies = {
  migration: interop.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: jobEndpoints.migration,
    preserveGatewayBasePath: true,
  }),
  maintenance: interop.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: jobEndpoints.maintenance,
    preserveGatewayBasePath: true,
  }),
  snapshot_upload: interop.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: jobEndpoints.snapshot_upload,
    preserveGatewayBasePath: true,
  }),
  download: interop.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: jobEndpoints.download,
    preserveGatewayBasePath: true,
  }),
} as const

// download_application_snapshot_v2.html: task table and cURL both specify GET for bytes.
export const downloadBytesEndpoint = interop.defineEndpoint({
  version: 'v2',
  method: 'GET',
  path: [oracleEpmLiteral('files'), oracleEpmLiteral('download'), jobId],
  body: 'none',
  response: 'stream',
  timeoutMs: 300_000,
  maxResponseBytes: DOWNLOAD_FILE_LIMIT,
})
export const downloadLinkPolicy = interop.defineReturnedLinkPolicy({
  relation: 'Download link',
  method: 'GET',
  endpoint: downloadBytesEndpoint,
  preserveGatewayBasePath: true,
})
export const deleteTemporaryDownloadEndpoint = interop.defineEndpoint({
  version: 'v2',
  method: 'DELETE',
  path: [oracleEpmLiteral('files'), oracleEpmLiteral('download'), jobId],
  body: 'none',
  response: 'json',
  timeoutMs: 10_000,
  maxResponseBytes: JSON_LIMIT,
})
