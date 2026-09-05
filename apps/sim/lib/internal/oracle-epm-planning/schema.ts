import { z } from 'zod'
import type { OracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import type { OracleEpmClientResponse } from '@/lib/internal/oracle-epm/types'
import {
  PLANNING_INLINE_BYTES,
  PLANNING_INPUT_FILE_BYTES,
} from '@/lib/internal/oracle-epm-planning/route-space'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { PlanningDimension } from '@/tools/oracle_epm_planning/types'

export interface PlanningOperationContext {
  client: OracleEpmClient
  signal?: AbortSignal
  runtime?: InternalToolOperationContext
}

export class PlanningInputError extends Error {}
export class PlanningContractError extends Error {
  constructor() {
    super('Oracle EPM Planning returned a response that does not match the documented contract')
  }
}

const name = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim().length > 0, 'Name cannot be blank')
const count = z.number().int().nonnegative().safe()
const strings = z.array(z.string())
const matrix = z.array(strings)
const axis = z.object({ dimensions: strings.optional(), members: matrix })
const gridDefinition = z.object({
  pov: axis,
  columns: z.array(axis),
  rows: z.array(axis),
  suppressMissingBlocks: z.boolean().optional(),
  suppressMissingRows: z.boolean().optional(),
  suppressMissingColumns: z.boolean().optional(),
})
export const dataGridSchema = z.object({
  pov: strings,
  columns: matrix,
  rows: z.array(
    z.object({ headers: strings, data: z.array(z.union([z.string(), z.number().finite()])) })
  ),
})
export const variableSchema = z.object({
  name: z.string(),
  value: z.string(),
  planType: z.string(),
})
const parameters = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]))
const authFields = {
  oauthCredential: z.string().min(1),
  accessToken: z.string().min(1),
  instanceUrl: z.string().min(1),
}
const inputFields = {
  application: name,
  cube: name,
  dimension: name,
  memberName: name,
  parentName: name,
  aliasTableName: name,
  variableName: name,
  variables: z
    .array(z.object({ name, value: z.string(), planType: name }))
    .min(1)
    .max(1000),
  derivedValues: z.boolean(),
  jobType: name,
  jobName: name,
  parameters,
  jobId: z.union([z.string().regex(/^[0-9]{1,32}$/), count.transform(String)]),
  maxWaitSeconds: z.number().int().min(1).max(3600),
  offset: count.max(1_000_000),
  limit: z.number().int().min(1).max(1000),
  messageType: z.enum(['INFO', 'WARNING', 'ERROR']),
  gridDefinition,
  dataGrid: dataGridSchema,
  importOptions: z
    .object({
      aggregateEssbaseData: z.boolean().optional(),
      cellNotesOption: z.enum(['Overwrite', 'Append', 'Skip']).optional(),
      dateFormat: z
        .enum(['MM-DD-YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY/MM/DD'])
        .optional(),
      strictDateValidation: z.boolean().optional(),
    })
    .strict(),
  clearEssbaseData: z.boolean(),
  clearPlanningData: z.boolean(),
  form: name,
  displayMemberAs: z.enum(['MEMBER_NAME', 'MEMBER_NAME_THEN_ALIAS', 'ALIAS_THEN_MEMBER_NAME']),
  memberAliasDelimiter: z.string().max(255),
  forceStartExpanded: z.boolean(),
  file: z.object({
    id: z.string().min(1),
    key: z.string().min(1),
    name,
    url: z.string(),
    size: count.max(PLANNING_INPUT_FILE_BYTES),
    type: z.string(),
    context: z.string().optional(),
  }),
  fileName: name,
  loginLevel: z.enum(['Administrators', 'All Users']),
}

export const planningListApplicationsInputSchema = z.object({
  ...authFields,
})

const memberOverrides = z.record(name, z.string().min(1))
const sequence = z.number().int().min(-1).safe()
const compoundIdentifier = name.refine(
  (value) => Buffer.byteLength(value, 'utf8') <= 255,
  'Compound identifiers are limited to 255 UTF-8 bytes'
)
const userVariableValue = z.object({ userName: name, name, dimension: name, member: name })
const insightAxis = z.object({ dimensions: strings, segments: z.array(matrix) }).strict()
/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_insigh.html */
export const insightSliceSchema = z
  .object({
    pov: z.object({ members: strings, dimensions: strings }).strict(),
    columnAxisDefinition: insightAxis,
    rowAxisDefinition: insightAxis,
  })
  .strict()
const insightFields = {
  cube: name,
  insightSlice: insightSliceSchema,
  retrievalMode: z.enum(['USE_EXISTING', 'FORCE_RECOMPUTE']).optional(),
  calendar: name.optional(),
}

export const planningRunDataMapInputSchema = z.object({
  ...authFields,
  application: name,
  jobName: name,
  clearData: z.boolean(),
  overrideMembersMap: memberOverrides.optional(),
  overrideExclusionMembersMap: memberOverrides.optional(),
})
export const planningListUserVariableValuesInputSchema = z.object({
  ...authFields,
  application: name,
  offset: inputFields.offset.optional(),
  limit: inputFields.limit.optional(),
})
export const planningSetUserVariableValuesInputSchema = z.object({
  ...authFields,
  application: name,
  userVariableValues: z.array(userVariableValue.strict()).min(1).max(1000),
})
export const planningListPlanningUnitsInputSchema = z.object({
  ...authFields,
  application: name,
  scenario: name,
  planningVersion: name,
  offset: inputFields.offset.optional(),
  limit: inputFields.limit.optional(),
})
export const planningGetPlanningUnitActionsInputSchema = z.object({
  ...authFields,
  application: name,
  puhIdentifier: compoundIdentifier,
  pmMembers: z.string().min(1).max(65536),
  approvalOptions: z.union([z.literal(0), z.literal(1)]).optional(),
})
export const planningGetPlanningUnitHistoryInputSchema = z.object({
  ...authFields,
  application: name,
  puIdentifier: compoundIdentifier,
  annotSeq: sequence.optional(),
  logSeq: sequence.optional(),
  offset: inputFields.offset.optional(),
  limit: inputFields.limit.optional(),
})
export const planningChangePlanningUnitStatusInputSchema = z.object({
  ...authFields,
  application: name,
  puhIdentifier: compoundIdentifier,
  pmMembers: z.string().min(1).max(65536),
  actionId: count.positive(),
  comments: z.string().max(65536).optional(),
})
export const planningGetInsightsInputSchema = z
  .object({
    ...authFields,
    application: name,
    ...insightFields,
  })
  .refine((input) => input.retrievalMode !== 'FORCE_RECOMPUTE' || !!input.calendar, {
    message: 'Recomputing insights requires a calendar',
    path: ['calendar'],
  })
/** Explicit mode prevents stale IDs from overriding a slice in Oracle's request precedence. */
export const planningSummarizeInsightsInputSchema = z
  .object({
    ...authFields,
    application: name,
    summaryInputMode: z.enum(['ids', 'slice']),
    insightIds: z
      .array(z.string().regex(/^[0-9]{1,32}$/))
      .min(1)
      .max(1000)
      .optional(),
    ...insightFields,
    cube: name.optional(),
    insightSlice: insightSliceSchema.optional(),
    summarySize: z.number().int().min(1).max(10000).optional(),
  })
  .superRefine((input, context) => {
    if (input.summaryInputMode === 'ids') {
      if (!input.insightIds)
        context.addIssue({ code: 'custom', path: ['insightIds'], message: 'Insight IDs are required' })
    } else {
      if (!input.cube)
        context.addIssue({
          code: 'custom',
          path: ['cube'],
          message: 'A cube is required for slice summaries',
        })
      if (!input.insightSlice)
        context.addIssue({
          code: 'custom',
          path: ['insightSlice'],
          message: 'An insight slice is required',
        })
      if (input.retrievalMode === 'FORCE_RECOMPUTE' && !input.calendar)
        context.addIssue({
          code: 'custom',
          path: ['calendar'],
          message: 'Recomputing insights requires a calendar',
        })
    }
  })

/** User values are distinct from user-variable definitions and substitution variables. */
export const userVariableValuesSchema = z.object({ items: z.array(userVariableValue).max(1000) })
/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_all_planning_units.html */
export const planningUnitsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().nullable(),
        value: z.number().finite(),
        owner: z.string(),
        version: z.string(),
        entity: z.string(),
        status: z.string(),
        scenario: z.string(),
        formattedValue: z.string(),
        puName: z.string(),
        subStatus: z.string(),
        secMember: z.string().nullable(),
        puAlias: z.string(),
        scenarioAlias: z.string().nullable(),
        versionAlias: z.string().nullable(),
        puId: count,
      })
    )
    .max(1000),
})
export const planningUnitActionsSchema = z.object({
  items: z.array(z.object({ actionId: count, name: z.string() })).max(1000),
})
/** The history page's media-type label conflicts with its explicit JSON body and field table. */
export const planningUnitHistorySchema = z.object({
  items: z
    .array(
      z.object({
        comment: z.string(),
        hasHistory: z.boolean(),
        logSeq: sequence,
        staticImage: z.boolean(),
        authorImagePath: z.string(),
        commentTitle: z.string(),
        commentDate: z.string(),
        commentSubTitle: z.string(),
        parentAnntSeq: sequence,
        isChildNode: z.boolean(),
        type: z.string().optional(),
      })
    )
    .max(1000),
})
/** Status changes return a confirmation in self-link data, not a job envelope. */
export const planningUnitStatusSchema = z.object({
  links: z
    .array(
      z.object({
        rel: z.string(),
        href: z.string(),
        action: z.string(),
        data: z.object({ pmMembers: z.string(), action: z.string(), comments: z.string() }).optional(),
      })
    )
    .max(1000),
})
export const insightsSchema = z.object({
  items: z.array(
    z.object({
      id: count.transform(String),
      type: z.enum(['ANOMALY', 'MOVEMENT_VARIANCE_INSIGHTS', 'HISTORICAL_INSIGHTS', 'FUTURE_INSIGHTS']),
      accountName: z.string().optional(),
      sourceAccountName: z.string().optional(),
      planType: z.string().optional(),
      actualImpact: z.string().optional(),
      percentImpact: z.string().optional(),
      createdDate: z.string().optional(),
      description: z.string().optional(),
      outlierValue: z.number().finite().optional(),
      standardVariance: z.string().optional(),
      actualImpactValue: z.number().finite().optional(),
      priority: z.string().optional(),
      pov: z.string().optional(),
      percentageDiff: z.string().optional(),
      percentageDiffFromAnomaly: z.string().optional(),
    })
  ),
  totalResults: count,
  hasMore: z.boolean(),
})
export const insightSummarySchema = z.object({ summary: z.string() })

export const planningListCubesInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
})

export const planningListDimensionsInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  cube: inputFields.cube,
  offset: inputFields.offset.optional(),
  limit: inputFields.limit.optional(),
})

export const planningGetDimensionInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  cube: inputFields.cube,
  dimension: inputFields.dimension,
  aliasTableName: inputFields.aliasTableName.optional(),
})

export const planningGetMemberInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  dimension: inputFields.dimension,
  memberName: inputFields.memberName,
})

export const planningAddMemberInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  dimension: inputFields.dimension,
  memberName: inputFields.memberName,
  parentName: inputFields.parentName,
})

export const planningListSubstitutionVariablesInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  cube: inputFields.cube.optional(),
  derivedValues: inputFields.derivedValues.optional(),
})

export const planningGetSubstitutionVariableInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  variableName: inputFields.variableName,
  cube: inputFields.cube.optional(),
  derivedValues: inputFields.derivedValues.optional(),
})

export const planningSetSubstitutionVariablesInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  variables: inputFields.variables,
})

export const planningDeleteSubstitutionVariableInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  variableName: inputFields.variableName,
  cube: inputFields.cube.optional(),
})

export const planningListJobDefinitionsInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobType: inputFields.jobType.optional(),
})

export const planningRunJobInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobType: inputFields.jobType,
  jobName: inputFields.jobName,
  parameters: inputFields.parameters.optional(),
})

export const planningRunRuleInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobName: inputFields.jobName,
  parameters: inputFields.parameters.optional(),
})

export const planningRunRulesetInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobName: inputFields.jobName,
  parameters: inputFields.parameters.optional(),
})

export const planningGetJobInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobId: inputFields.jobId,
})

export const planningWaitForJobInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobId: inputFields.jobId,
  maxWaitSeconds: inputFields.maxWaitSeconds.optional(),
})

export const planningGetJobDetailsInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobId: inputFields.jobId,
  offset: inputFields.offset.optional(),
  limit: inputFields.limit.optional(),
  messageType: inputFields.messageType.optional(),
})

export const planningExportDataSliceInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  cube: inputFields.cube,
  gridDefinition: inputFields.gridDefinition,
})

export const planningImportDataSliceInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  cube: inputFields.cube,
  dataGrid: inputFields.dataGrid,
  importOptions: inputFields.importOptions.optional(),
})

export const planningClearDataSliceInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  cube: inputFields.cube,
  gridDefinition: inputFields.gridDefinition,
  clearEssbaseData: inputFields.clearEssbaseData.optional(),
  clearPlanningData: inputFields.clearPlanningData.optional(),
})

export const planningExportFormDataInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  form: inputFields.form,
  displayMemberAs: inputFields.displayMemberAs.optional(),
  memberAliasDelimiter: inputFields.memberAliasDelimiter.optional(),
  forceStartExpanded: inputFields.forceStartExpanded.optional(),
})

export const planningExportApplicationDataInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobName: inputFields.jobName.optional(),
  cube: inputFields.cube.optional(),
  parameters: inputFields.parameters.optional(),
})

export const planningImportApplicationDataInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobName: inputFields.jobName.optional(),
  cube: inputFields.cube.optional(),
  fileName: inputFields.fileName.optional(),
  parameters: inputFields.parameters.optional(),
})

export const planningListFilesInputSchema = z.object({
  ...authFields,
})

export const planningUploadFileInputSchema = z.object({
  ...authFields,
  file: inputFields.file,
  fileName: inputFields.fileName.optional(),
  maxWaitSeconds: inputFields.maxWaitSeconds.optional(),
})

export const planningDownloadFileInputSchema = z.object({
  ...authFields,
  fileName: inputFields.fileName,
  maxWaitSeconds: inputFields.maxWaitSeconds.optional(),
})

export const planningDeleteFileInputSchema = z.object({
  ...authFields,
  fileName: inputFields.fileName,
})

export const planningRefreshCubeInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  jobName: inputFields.jobName,
  parameters: inputFields.parameters.optional(),
})

export const planningSetAdministrationModeInputSchema = z.object({
  ...authFields,
  application: inputFields.application,
  loginLevel: inputFields.loginLevel,
  jobName: inputFields.jobName.optional(),
})

/**
 * Count JSON bytes before serialization without creating a width-sized work queue.
 * Recursion and retained cycle bookkeeping are bounded to 64 containers.
 */
export function assertPlanningPayload(value: unknown): number {
  let bytes = 0
  let nodes = 0
  const ancestors = new Set<object>()
  const add = (size: number) => {
    bytes += size
    if (bytes > PLANNING_INLINE_BYTES) throw oracleEpmLocalError('payload_too_large')
  }
  const stringBytes = (text: string) => {
    add(2 + Buffer.byteLength(text, 'utf8'))
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code === 34 || code === 92) add(1)
      else if (code < 32) add([8, 9, 10, 12, 13].includes(code) ? 1 : 5)
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1)
        if (next >= 0xdc00 && next <= 0xdfff) i++
        else add(3)
      } else if (code >= 0xdc00 && code <= 0xdfff) add(3)
    }
  }
  const visit = (entry: unknown, depth: number): void => {
    if (++nodes > 1_000_000 || depth > 64) throw oracleEpmLocalError('payload_too_large')
    if (typeof entry === 'string') {
      stringBytes(entry)
      return
    }
    if (entry === null || entry === undefined) {
      add(4)
      return
    }
    if (typeof entry === 'boolean') {
      add(entry ? 4 : 5)
      return
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      add(String(entry).length)
      return
    }
    if (typeof entry !== 'object') throw oracleEpmLocalError('invalid_input')
    if (ancestors.has(entry)) throw oracleEpmLocalError('invalid_input')
    const array = Array.isArray(entry)
    if (
      !array &&
      Object.getPrototypeOf(entry) !== Object.prototype &&
      Object.getPrototypeOf(entry) !== null
    ) {
      throw oracleEpmLocalError('invalid_input')
    }
    ancestors.add(entry)
    add(2)
    let first = true
    if (array) {
      if (entry.length + nodes > 1_000_000) throw oracleEpmLocalError('payload_too_large')
      for (const child of entry) {
        if (!first) add(1)
        first = false
        visit(child, depth + 1)
      }
    } else {
      for (const key in entry) {
        if (!Object.hasOwn(entry, key)) continue
        const descriptor = Object.getOwnPropertyDescriptor(entry, key)!
        if (!('value' in descriptor)) throw oracleEpmLocalError('invalid_input')
        if (descriptor.value === undefined) continue
        if (!first) add(1)
        first = false
        stringBytes(key)
        add(1)
        visit(descriptor.value, depth + 1)
      }
    }
    ancestors.delete(entry)
  }
  visit(value, 0)
  return bytes
}

export function parsePlanningResponse<S extends z.ZodType>(
  schema: S,
  response: OracleEpmClientResponse
): z.output<S> {
  if (!('data' in response)) throw new PlanningContractError()
  assertPlanningPayload(response.data)
  const parsed = schema.safeParse(response.data)
  if (!parsed.success) throw new PlanningContractError()
  return parsed.data
}

/** get_applications.html documents booleans and string-valued boolean examples. */
const documentedBoolean = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
])
export const applicationsSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      type: z.string().optional(),
      appType: z.string().optional(),
      appStorage: z.string().optional(),
      unicode: documentedBoolean.optional(),
      adminMode: documentedBoolean.optional(),
      hybrid: documentedBoolean.optional(),
    })
  ),
})
export const cubesSchema = z.object({
  items: z.array(
    z.object({
      planTypeName: z.string(),
      planType: count,
      cubeName: z.string(),
      numDimensions: count,
      cubeType: count,
    })
  ),
})

/** get_dim_details.html: leaves omit children; this is a hierarchy, not an items envelope. */
const dimensionFields = {
  name: z.string(),
  id: z.string().optional(),
  path: z.string().optional(),
  alias: z.string().optional(),
  parentName: z.string().optional(),
  dimName: z.string().optional(),
  dimType: z.string().optional(),
  level: count.optional(),
  generation: count.optional(),
}
export const dimensionSchema: z.ZodType<PlanningDimension> = z.lazy(() =>
  z.object({
    ...dimensionFields,
    children: z.array(dimensionSchema).optional(),
  })
)
export const dimensionsSchema = z.object({
  items: z.array(z.object(dimensionFields)),
  totalResults: count,
  hasMore: z.boolean(),
})

/** get_member.html and add_member.html: expose the verified core, not the ambiguous children example. */
export const memberSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  parentName: z.string().nullable(),
  dimName: z.string(),
  dataType: z.string().optional(),
  dataStorage: z.string(),
  objectType: z.number().int(),
  twoPass: z.boolean(),
})
export const variablesSchema = z.object({ items: z.array(variableSchema) })
export const jobDefinitionsSchema = z.object({
  items: z.array(z.object({ jobName: z.string(), jobType: z.string() })),
})

/** execute_a_job.html uses jobID; retrieve_job_status.html uses jobId and jobStatus in an error example. */
export const jobSchema = z
  .object({
    jobId: count.optional(),
    jobID: count.optional(),
    status: z.number().int(),
    details: z.string().nullable(),
    jobName: z.string(),
    descriptiveStatus: z.string().nullable().optional(),
    jobStatus: z.string().optional(),
    detailedStatus: z.number().int().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.jobId === undefined && value.jobID === undefined)
      ctx.addIssue({ code: 'custom', message: 'Missing job ID' })
    if (value.jobId !== undefined && value.jobID !== undefined && value.jobId !== value.jobID)
      ctx.addIssue({ code: 'custom', message: 'Conflicting job IDs' })
    if (value.descriptiveStatus === undefined && value.jobStatus === undefined)
      ctx.addIssue({ code: 'custom', message: 'Missing status description' })
  })
  .transform((value) => ({
    jobId: (value.jobId ?? value.jobID)!,
    status: value.status,
    details: value.details,
    jobName: value.jobName,
    descriptiveStatus: value.descriptiveStatus ?? value.jobStatus ?? null,
    ...(value.detailedStatus === undefined ? {} : { detailedStatus: value.detailedStatus }),
  }))

/** retrieve_job_status_details.html documents a page without totalResults/hasMore. */
export const jobDetailsSchema = z.object({
  items: z.array(
    z
      .object({
        recordsRead: count.optional(),
        recordsRejected: count.optional(),
        recordsProcessed: count.optional(),
        dimensionName: z.string().optional(),
        loadType: z.string().optional(),
      })
      .refine((value) => Object.keys(value).length > 0, 'Missing diagnostic fields')
  ),
})

/** import_dataslices.html: retain counts even when Oracle accepts HTTP but rejects cells. */
export const importResultSchema = z.object({
  numAcceptedCells: count,
  numUpdateCells: count,
  numRejectedCells: count,
  rejectedCells: strings.optional().default([]),
  rejectedCellsWithDetails: z
    .array(
      z.object({
        memberNames: strings,
        readOnlyReasons: strings,
        otherReasons: strings,
      })
    )
    .optional()
    .default([]),
})
export const clearResultSchema = z.object({
  numClearedCells: count,
  numRejectedCells: count,
  rejectedCells: strings,
})

/** get_export_form_data.html: form POV is a map and form rows contain numeric data. */
export const formDataSchema = z.object({
  gridInfo: z.object({
    pageDimNames: strings,
    allowedPageMembersByDim: z.record(z.string(), strings),
    rowDimNames: strings,
    columnDimNames: strings,
  }),
  pov: z.record(z.string(), z.string()),
  columns: matrix,
  rows: z.array(z.object({ headers: strings, data: z.array(z.number().finite()) })),
})

const integerString = z
  .string()
  .regex(/^[0-9]+$/)
  .transform(Number)
  .pipe(count)
export const interopStatusSchema = z.object({
  status: z.number().int(),
  details: z.string().nullable(),
  links: z
    .array(
      z
        .object({
          rel: z.string(),
          href: z.string(),
          method: z.string().optional(),
          action: z.string().optional(),
        })
        .refine(
          (link) =>
            link.method === undefined || link.action === undefined || link.method === link.action,
          'Conflicting link methods'
        )
        .transform(({ action, ...link }) => ({
          ...link,
          method: link.method ?? action,
        }))
    )
    .optional()
    .default([]),
})
/** list_files_v2.html: sizes/timestamps are strings or null, not invented numeric fields. */
export const filesSchema = interopStatusSchema.extend({
  items: z.array(
    z
      .object({
        name: z.string(),
        type: z.enum(['LCM', 'EXTERNAL']),
        size: integerString.nullable(),
        lastmodifiedtime: integerString.nullable(),
      })
      .transform(({ lastmodifiedtime, ...file }) => ({
        ...file,
        lastModifiedTime: lastmodifiedtime,
      }))
  ),
})

/** Service status is independent of HTTP success. Do not reflect arbitrary provider errors. */
export function requireInteropSuccess(status: { status: number }): void {
  if (status.status !== 0)
    throw new PlanningInputError(
      'Oracle repository operation failed; check permissions, file conflicts and Oracle job diagnostics'
    )
}
