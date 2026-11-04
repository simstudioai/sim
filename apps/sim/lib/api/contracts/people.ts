import { z } from 'zod'
import {
  type ContractBody,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import {
  DIRECTORY_TEXT_MAX_LENGTH,
  memberProfileFieldsSchema,
  PEOPLE_DEPARTMENT_KEY_PATTERN,
  PEOPLE_ID_MAX_LENGTH,
  PEOPLE_SEARCH_MAX_LENGTH,
} from '@/lib/people/validation'

/** Rows one import may carry; larger organizations import in several files. */
export const PEOPLE_IMPORT_MAX_ROWS = 10_000
export const PEOPLE_IMPORT_MAX_COLUMNS = 100

const params = z.object({ id: organizationIdSchema })
const departmentKey = z.string().regex(PEOPLE_DEPARTMENT_KEY_PATTERN)
const personParams = params.extend({ memberId: z.string().min(1).max(PEOPLE_ID_MAX_LENGTH) })

const personSummarySchema = z.object({
  memberId: z.string(),
  /** Null for a directory identity without an organization membership. */
  userId: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  title: z.string().nullable(),
})
export type PersonSummary = z.output<typeof personSummarySchema>

const personSchema = personSummarySchema.extend({
  department: z.string().nullable(),
  departmentKey: departmentKey.optional(),
  location: z.string().nullable(),
  /** `YYYY-MM-DD`. */
  startDate: z.string().nullable(),
  /** The manager as shown; `null` when there is none or they are suspended. */
  manager: personSummarySchema.nullable(),
  /** The stored manager link, kept while that manager is suspended. */
  managerMemberId: z.string().nullable(),
  directorySource: z.enum(['okta', 'entra', 'scim']).nullable(),
  joinedAt: z.iso.datetime().nullable(),
})
export type Person = z.output<typeof personSchema>
export type PersonBody = z.input<typeof memberProfileFieldsSchema>

export const listPeopleContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/people',
  params,
  query: z.object({
    scope: z.enum(['roots', 'members']).optional(),
    search: z.string().max(PEOPLE_SEARCH_MAX_LENGTH).optional(),
    department: z.string().max(DIRECTORY_TEXT_MAX_LENGTH).optional(),
    departmentKey: departmentKey.optional(),
    cursor: z.string().min(1).max(1024).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      people: z.array(personSchema),
      selectedDepartment: z.string().nullable(),
      nextCursor: z.string().nullable(),
    }),
  },
})

export const listDepartmentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/people/departments',
  params,
  query: z.object({
    search: z.string().max(PEOPLE_SEARCH_MAX_LENGTH).optional(),
    cursor: z.string().min(1).max(1024).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      /** Largest first. */
      departments: z.array(
        z.object({
          name: z.string(),
          count: z.number().int(),
          departmentKey: departmentKey.optional(),
        })
      ),
      nextCursor: z.string().nullable(),
    }),
  },
})

export const getPeopleChartContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/people/chart',
  params,
  query: z.object({
    memberId: personParams.shape.memberId.optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    size: z.coerce.number().int().min(1).max(4).default(4),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      person: personSchema,
      chain: z.array(personSummarySchema),
      reports: z.array(
        personSummarySchema.extend({
          department: z.string().nullable(),
          reportCount: z.number().int(),
        })
      ),
      totalReports: z.number().int(),
      page: z.number().int(),
    }),
  },
})

export type ChartBranch = ContractJsonResponse<typeof getPeopleChartContract>

export const getPersonContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/people/[memberId]',
  params: personParams,
  response: {
    mode: 'json',
    schema: z.object({
      person: personSchema,
      /** Managers above this person, nearest first. */
      chain: z.array(personSummarySchema),
      /** The first fifty direct reports, in directory order. */
      reports: z.array(personSummarySchema),
      totalReports: z.number().int(),
    }),
  },
})

export const updatePersonContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/people/[memberId]',
  params: personParams,
  body: memberProfileFieldsSchema,
  response: { mode: 'json', schema: z.object({ person: personSchema }) },
})

const previewDigestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const peopleImportResultSchema = z.object({
  /** Profiles the import changed, or would change on a preview. */
  updated: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
  warnings: z.number().int(),
  /** The first issues in file order; `skipped` and `warnings` count every one. */
  issues: z.array(
    z.object({
      row: z.number().int(),
      email: z.string().nullable(),
      severity: z.enum(['skipped', 'warning']),
      message: z.string(),
    })
  ),
  applied: z.boolean(),
  previewDigest: previewDigestSchema.optional(),
})
export type PeopleImportResult = z.output<typeof peopleImportResultSchema>

const directoryToken = z
  .string()
  .trim()
  .min(1)
  .max(32_768)
  .regex(/^[!-~]+$/, 'Enter a valid token')

export const importPeopleContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/people/import',
  params,
  body: z
    .union([
      z
        .object({
          headers: z
            .array(z.string().max(200))
            .min(1)
            .max(PEOPLE_IMPORT_MAX_COLUMNS)
            .refine(
              (headers) => new Set(headers).size === headers.length,
              'Each column must have its own name'
            ),
          /** Each row's cells in header order; a short row leaves its trailing cells blank. */
          rows: z
            .array(z.array(z.string().max(1000)).max(PEOPLE_IMPORT_MAX_COLUMNS))
            .min(1, 'The file has no rows')
            .max(PEOPLE_IMPORT_MAX_ROWS, `Import at most ${PEOPLE_IMPORT_MAX_ROWS} rows at a time`),
          /** `false` previews the import without changing anything. */
          apply: z.boolean(),
        })
        .strict(),
      z
        .object({
          source: z.literal('directory'),
          apply: z.boolean(),
          previewDigest: previewDigestSchema.optional(),
        })
        .strict(),
      z
        .object({
          source: z.literal('okta'),
          domain: z.string().trim().min(1).max(255),
          token: directoryToken,
          apply: z.boolean(),
          previewDigest: previewDigestSchema.optional(),
        })
        .strict(),
      z
        .object({
          source: z.literal('entra'),
          token: directoryToken,
          apply: z.boolean(),
          previewDigest: previewDigestSchema.optional(),
        })
        .strict(),
    ])
    .refine((input) => !('source' in input) || !input.apply || Boolean(input.previewDigest), {
      path: ['previewDigest'],
      message: 'Preview the directory before importing.',
    }),
  response: { mode: 'json', schema: peopleImportResultSchema },
})

export type PeopleImportBody = ContractBody<typeof importPeopleContract>
