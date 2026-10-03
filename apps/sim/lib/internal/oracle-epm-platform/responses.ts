import { z } from 'zod'
import type { OracleEpmClientResponse } from '@/lib/internal/oracle-epm/types'
import type { OracleEpmBatchResult, OracleEpmStatus } from '@/tools/oracle_epm_platform/types'

const text = z.string()
const count = z.number().int().nonnegative().safe()
const numericString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(Number)
  .pipe(count)
const status = z.union([
  z.number().int().min(-1).safe(),
  z
    .string()
    .regex(/^(?:-1|0|[1-9][0-9]*)$/)
    .transform(Number)
    .pipe(z.number().int().min(-1).safe()),
])
const statusSchema = z.object({ status })

/** Never expose a validator's input, provider body, or secret-bearing error message. */
export class OracleEpmPlatformResponseError extends Error {
  constructor() {
    super(
      'Oracle EPM returned an unexpected response; verify this operation is supported by the environment'
    )
    this.name = 'OracleEpmPlatformResponseError'
  }
}
export class OracleEpmPlatformStatusError extends Error {
  readonly status: number
  constructor(code: number) {
    super(`Oracle EPM reported operation failure (status ${code})`)
    this.name = 'OracleEpmPlatformStatusError'
    this.status = code
  }
}

export function parseResponse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new OracleEpmPlatformResponseError()
  return parsed.data
}
export function jsonBody(response: OracleEpmClientResponse): unknown {
  if (!('data' in response)) throw new OracleEpmPlatformResponseError()
  return response.data
}

export function readStatus(value: unknown): number {
  return parseResponse(statusSchema, value).status
}
export function statusOutput(code: number): OracleEpmStatus {
  return {
    status: code,
    message:
      code === 0
        ? 'Operation completed'
        : code === -1
          ? 'Operation in progress'
          : `Oracle EPM reported operation failure (status ${code})`,
  }
}
export function requireSuccess(value: unknown): OracleEpmStatus {
  const code = readStatus(value)
  if (code !== 0) throw new OracleEpmPlatformStatusError(code)
  return statusOutput(code)
}

// Only follow-up links are interpreted. Self links and data echoes are never returned.
export const linksSchema = z.object({
  links: z.array(z.object({ rel: text, href: text, action: text.optional() })),
})
export const tasksSchema = z.object({
  items: z.array(z.object({ name: text, source: text, destination: text })).nullish(),
})

// lcm_get_build_version_and_maintenance_time_v2.html; showTimeZone=true is requested.
export const environmentSchema = z.object({
  items: z
    .array(
      z.object({
        buildVersion: text,
        amwTime: text,
        timeZone: text.optional(),
      })
    )
    .min(1),
})
// The configuration endpoints document strings for both timeout and booleans.
export const idleTimeoutSchema = z.object({
  items: z.array(z.object({ timeout: numericString })).length(1),
})
export const restrictedDataSchema = z.object({
  items: z
    .array(
      z.object({
        dataAccessRestriction: z.enum(['true', 'false']).transform((value) => value === 'true'),
      })
    )
    .length(1),
})
export const virusScanSchema = z.object({
  items: z
    .array(
      z.object({
        scanfiles: z.enum(['true', 'false']).transform((value) => value === 'true'),
      })
    )
    .length(1),
})

const user = z.object({
  userlogin: text,
  firstname: text,
  lastname: text,
  email: text,
})
const groupSummary = z.object({ groupname: text, description: text, type: text })
const roleAssignment = z.object({ rolename: text, id: text })
// List/report optional expansions are absent when not requested, not synthesized empty arrays.
export const usersSchema = z.object({
  details: z.array(
    user.extend({
      epmgroups: z.array(groupSummary).optional(),
      idcsgroups: z.array(groupSummary).optional(),
      granularroles: z.array(roleAssignment).optional(),
      applicationroles: z.array(roleAssignment).optional(),
    })
  ),
})
export const groupsSchema = z.object({
  details: z.array(
    groupSummary.extend({
      identity: text,
      members: z.object({ users: z.array(user), groups: z.array(groupSummary) }).optional(),
      roles: z.array(roleAssignment).optional(),
    })
  ),
})
export const rolesSchema = z.object({
  details: z.array(z.object({ name: text, id: text })),
})
export const roleReportSchema = z.object({
  details: z.array(
    user.extend({
      roles: z.array(z.object({ rolename: text, roletype: text, grantedthroughgroup: text })),
    })
  ),
})
export const groupReportSchema = z.object({
  details: z.array(
    user.extend({
      groups: z.array(
        z.object({
          groupname: text,
          direct: z.enum(['Yes', 'No']).transform((value) => value === 'Yes'),
        })
      ),
    })
  ),
})

// Security v2 examples use a different links object and details shape than interop APIs.
// Project failure identifiers/codes, not errormessage, which may echo password-bearing input.
const errorcode = z.string().regex(/^EPMCSS-[0-9]{5}$/)
const failedUser = z.object({ userlogin: text, errorcode })
const failedGroup = z.object({ groupname: text, errorcode })
const failedItem = z
  .object({
    userlogin: text.optional(),
    groupname: text.optional(),
    errorcode,
    // Add Groups v2 documents nested failures when a group is created but members cannot be added.
    erroritems: z
      .object({
        users: z.array(failedUser).optional(),
        groups: z.array(failedGroup).optional(),
      })
      .optional(),
  })
  .refine((item) => item.userlogin !== undefined || item.groupname !== undefined)
const batchSchema = z.object({
  status: z.union([z.literal(0), z.literal(1)]),
  error: z.object({ errorcode }).nullable(),
  details: z
    .object({
      processed: count,
      succeeded: count,
      failed: count,
      faileditems: z.array(failedItem).nullable(),
    })
    .nullable(),
})
export function projectBatch(value: unknown): OracleEpmBatchResult {
  const result = parseResponse(batchSchema, value)
  if (result.status === 0 && (!result.details || result.error)) {
    throw new OracleEpmPlatformResponseError()
  }
  const details = result.details
  if (
    details &&
    (details.succeeded + details.failed !== details.processed ||
      (details.failed === 0 && (details.faileditems?.length ?? 0) !== 0) ||
      (details.failed > 0 && !details.faileditems?.length))
  )
    throw new OracleEpmPlatformResponseError()
  const partialFailure = result.status === 0 && (details?.failed ?? 0) > 0
  return {
    ...statusOutput(result.status),
    ...(partialFailure ? { message: 'Oracle EPM processed the batch with item failures' } : {}),
    processed: details?.processed ?? null,
    succeeded: details?.succeeded ?? null,
    failed: details?.failed ?? null,
    partialFailure,
    failedItems: details?.faileditems ?? [],
    errorCode: result.error?.errorcode ?? null,
  }
}

// list_files_v2.html explicitly returns null size/mtime for LCM snapshots.
export const filesSchema = z.object({
  items: z.array(
    z
      .object({
        name: text,
        type: z.enum(['LCM', 'EXTERNAL']),
        size: numericString.nullable(),
        lastmodifiedtime: numericString.nullable(),
      })
      .transform(({ lastmodifiedtime, ...file }) => ({
        ...file,
        lastModifiedTime: lastmodifiedtime,
      }))
  ),
})
// Both spellings occur in Oracle's snapshot reference (JSON example versus cURL sample).
const lowerSnapshot = z
  .object({
    name: text,
    type: z.enum(['LCM', 'EXTERNAL']),
    canexport: z.boolean(),
    canimport: z.boolean(),
    canupload: z.boolean(),
    candownload: z.boolean(),
  })
  .transform((item) => ({
    name: item.name,
    type: item.type,
    canExport: item.canexport,
    canImport: item.canimport,
    canUpload: item.canupload,
    canDownload: item.candownload,
  }))
const camelSnapshot = z.object({
  name: text,
  type: z.enum(['LCM', 'EXTERNAL']),
  canExport: z.boolean(),
  canImport: z.boolean(),
  canUpload: z.boolean(),
  canDownload: z.boolean(),
})
export const snapshotsSchema = z.object({
  items: z.array(z.union([lowerSnapshot, camelSnapshot])),
})

// migration_generate_status_report.html. Nested message payloads are not returned as dynamic JSON:
// only the documented report arrays' counts are projected, alongside the documented scalar fields.
export const migrationsSchema = z.object({
  items: z.array(
    z.object({
      action: text,
      duration: text,
      status: text,
      user: text,
      snapshot: text,
      endTime: text,
      startTime: text,
      report: z.array(
        z
          .object({
            destination: text,
            source: text,
            status: text,
            errors: z.array(z.unknown()),
            warnings: z.array(z.unknown()),
          })
          .transform(({ errors, warnings, ...entry }) => ({
            ...entry,
            errorCount: errors.length,
            warningCount: warnings.length,
          }))
      ),
    })
  ),
})
