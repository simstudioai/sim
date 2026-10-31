import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { memberProfileFieldsSchema } from '@/lib/people/validation'

/** Rows one import may carry; larger organizations import in several files. */
export const PEOPLE_IMPORT_MAX_ROWS = 10_000

const params = z.object({ id: organizationIdSchema })
const personParams = params.extend({ memberId: z.string().min(1).max(255) })

const personSummarySchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  title: z.string().nullable(),
})
export type PersonSummary = z.output<typeof personSummarySchema>

const personSchema = personSummarySchema.extend({
  department: z.string().nullable(),
  location: z.string().nullable(),
  /** `YYYY-MM-DD`. */
  startDate: z.string().nullable(),
  manager: personSummarySchema.nullable(),
  joinedAt: z.iso.datetime(),
})
export type Person = z.output<typeof personSchema>
export type PersonBody = z.input<typeof memberProfileFieldsSchema>

export const listPeopleContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/people',
  params,
  query: z.object({
    search: z.string().max(200).optional(),
    department: z.string().max(200).optional(),
    cursor: z.string().min(1).max(1024).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({ people: z.array(personSchema), nextCursor: z.string().nullable() }),
  },
})

export const listDepartmentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/people/departments',
  params,
  response: {
    mode: 'json',
    schema: z.object({
      /** Largest first. */
      departments: z.array(z.object({ name: z.string(), count: z.number().int() })),
    }),
  },
})

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
      reports: z.array(personSummarySchema),
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
})
export type PeopleImportResult = z.output<typeof peopleImportResultSchema>

export const importPeopleContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/people/import',
  params,
  body: z
    .object({
      headers: z
        .array(z.string().max(200))
        .min(1)
        .max(100)
        .refine(
          (headers) => new Set(headers).size === headers.length,
          'Each column must have its own name'
        ),
      /** Each row's cells in header order; a short row leaves its trailing cells blank. */
      rows: z
        .array(z.array(z.string().max(1000)).max(100))
        .min(1, 'The file has no rows')
        .max(PEOPLE_IMPORT_MAX_ROWS, `Import at most ${PEOPLE_IMPORT_MAX_ROWS} rows at a time`),
      /** `false` previews the import without changing anything. */
      apply: z.boolean(),
    })
    .strict(),
  response: { mode: 'json', schema: peopleImportResultSchema },
})
