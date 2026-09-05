import { z } from 'zod'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import type { UserFile } from '@/executor/types'
import type { OracleEpmPlatformOperation } from '@/tools/oracle_epm_platform/types'

const text = z.string().max(1024)
const name = text.min(1).refine((value) => value.trim().length > 0)
const path = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <= 255 &&
      !/[\\\\\u0000-\u001f\u007f]/.test(value) &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..' && !/^[A-Za-z]:/.test(part)),
    'Provide a repository path without empty, dot, or drive segments'
  )
const snapshotName = path.refine(
  (value) => !value.includes('/'),
  'Provide a snapshot name, not a path'
)
const userReference = z.object({ userlogin: name }).strict()
const groupReference = z.object({ groupname: name }).strict()
const userReferences = z.array(userReference).min(1).max(1000)
const groupReferences = z.array(groupReference).min(1).max(1000)
const file = z.custom<UserFile>(isUserFileWithMetadata, 'Provide a canonical uploaded UserFile')
const auth = {
  oauthCredential: z.string().min(1).max(512),
  accessToken: z.string().min(1).max(4096),
  instanceUrl: z.string().min(1).max(4096),
}
const filters = { userlogin: name.optional(), userattribute: name.optional() }
const empty = z.object(auth)

/** Input contracts, not UI coercion: reference/JSON resolution belongs in tools.config.params. */
export const inputSchemas = {
  get_environment_info: empty,
  get_idle_session_timeout: empty,
  set_idle_session_timeout: z.object({
    ...auth,
    timeoutMinutes: z.number().int().min(15).max(480),
  }),
  set_maintenance_window: z.object({
    ...auth,
    startTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):00(?: [A-Za-z][A-Za-z0-9_+\\/-]*)?$/),
  }),
  run_daily_maintenance: z.object({ ...auth, skipNext: z.boolean().optional() }),
  get_restricted_data_access: empty,
  set_restricted_data_access: z.object({ ...auth, enabled: z.boolean() }),
  get_upload_virus_scan: empty,
  set_upload_virus_scan: z.object({ ...auth, enabled: z.boolean() }),
  list_users: z.object({
    ...auth,
    ...filters,
    epmgroups: z.boolean().optional(),
    idcsgroups: z.boolean().optional(),
    granularroles: z.boolean().optional(),
    applicationroles: z.boolean().optional(),
    indirect: z.boolean().optional(),
  }),
  create_users: z.object({
    ...auth,
    users: z
      .array(
        z
          .object({
            userlogin: name,
            firstname: text.optional(),
            lastname: name,
            email: name,
            password: z.string().min(1).max(1024).optional(),
            resetpassword: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(1000),
  }),
  update_users: z.object({
    ...auth,
    users: z
      .array(
        z
          .object({
            userlogin: name,
            firstname: text.optional(),
            lastname: text.optional(),
            email: text.optional(),
          })
          .strict()
          .refine(
            (user) =>
              user.firstname !== undefined ||
              user.lastname !== undefined ||
              user.email !== undefined,
            'Each update requires at least one attribute'
          )
      )
      .min(1)
      .max(1000),
  }),
  delete_users: z.object({ ...auth, users: userReferences }),
  // Oracle's type parameter is deliberately omitted: its table and JSON example disagree.
  list_groups: z.object({
    ...auth,
    groupname: name.optional(),
    members: z.boolean().optional(),
    roles: z.boolean().optional(),
  }),
  create_groups: z.object({
    ...auth,
    groups: z
      .array(
        z
          .object({
            groupname: name,
            description: text.optional(),
            members: z
              .object({
                users: z.array(userReference).max(1000).optional(),
                groups: z.array(groupReference).max(1000).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
      )
      .min(1)
      .max(1000),
  }),
  delete_groups: z.object({ ...auth, groups: groupReferences }),
  add_users_to_group: z.object({ ...auth, groupname: name, users: userReferences }),
  remove_users_from_group: z.object({ ...auth, groupname: name, users: userReferences }),
  list_roles: z.object({ ...auth, type: z.enum(['application', 'granular']).optional() }),
  assign_role: z.object({ ...auth, rolename: name, users: userReferences }),
  unassign_role: z.object({ ...auth, rolename: name, users: userReferences }),
  get_role_assignments: z.object({ ...auth, ...filters, rolename: name.optional() }),
  get_user_group_report: z.object({ ...auth, ...filters, groupname: name.optional() }),
  list_files: empty,
  delete_file: z.object({ ...auth, fileName: path }),
  upload_repository_file: z.object({
    ...auth,
    file,
    fileName: path,
    directory: z
      .string()
      .max(1024)
      .regex(
        /^(?:to_be_imported|(?:inbox|outbox|profitinbox|profitoutbox)(?:\/[^/\\\\\u0000-\u001f\u007f]+)*)$/
      )
      .refine((value) => value.split('/').every((part) => part !== '.' && part !== '..'))
      .optional(),
  }),
  download_file: z.object({ ...auth, fileName: path }),
  get_snapshot: z.object({ ...auth, snapshotName }),
  export_snapshot: z.object({ ...auth, snapshotName }),
  import_snapshot: z
    .object({
      ...auth,
      snapshotName,
      importUsers: z.boolean().optional(),
      userPassword: z.string().min(1).max(1024).optional(),
      resetPassword: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.importUsers === true ||
        (value.userPassword === undefined && value.resetPassword === undefined),
      'Password options require importing users'
    ),
  rename_snapshot: z.object({ ...auth, snapshotName, newSnapshotName: snapshotName }),
  list_migrations: empty,
  upload_snapshot: z.object({
    ...auth,
    file,
    snapshotName: snapshotName.refine(
      (value) => value.toLowerCase().endsWith('.zip'),
      'Snapshot upload name must end in .zip'
    ),
  }),
  get_admin_job_status: z.object({
    ...auth,
    jobId: z.string().regex(/^[0-9]{1,64}$/),
    jobKind: z.enum(['migration', 'maintenance', 'snapshot_upload']),
    waitForCompletion: z.boolean().optional(),
  }),
} satisfies Record<OracleEpmPlatformOperation, z.ZodType>

export type OracleEpmPlatformInput<K extends OracleEpmPlatformOperation> = z.output<
  (typeof inputSchemas)[K]
>
