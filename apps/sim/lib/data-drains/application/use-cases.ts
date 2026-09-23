import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { dataDrainRuns, dataDrains } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { and, asc, desc, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import {
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { getJobQueue } from '@/lib/core/async-jobs'
import { isBillingEnabled, isDataDrainsEnabled } from '@/lib/core/config/env-flags'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  type DataDrainOperation,
  dataDrainOperations,
} from '@/lib/data-drains/application/operations'
import { getDestination } from '@/lib/data-drains/destinations/registry'
import { decryptCredentials, encryptCredentials } from '@/lib/data-drains/encryption'
import {
  type CreateDataDrainInput,
  createDataDrainBodySchema,
  type UpdateDataDrainInput,
  updateDataDrainBodySchema,
} from '@/lib/data-drains/validation'

const logger = createLogger('DataDrainApplication')
export type DataDrainRecord = Omit<typeof dataDrains.$inferSelect, 'destinationCredentials'>
interface OrganizationInput {
  organizationId: string
}
interface DrainInput extends OrganizationInput {
  drainId: string
}
interface Execution<I> {
  principal: Principal
  input: I
  request?: OrchestrationRequestContext
}

/** Preserves membership, deployment and administrator checks before exposing a drain. */
export async function authorizeDataDrainOperation(
  principal: Principal,
  operation: DataDrainOperation,
  input: OrganizationInput
): Promise<void> {
  let roleError: OrchestrationError | undefined
  try {
    await authorizeOrganizationOperation(principal, operation, input)
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'not_found') {
      throw new OrchestrationError('forbidden', 'Forbidden - Not a member of this organization')
    }
    if (
      error instanceof OrchestrationError &&
      error.code === 'forbidden' &&
      error.message === 'Organization administrator access is required'
    )
      roleError = error
    else throw error
  }
  if (!isBillingEnabled && !isDataDrainsEnabled)
    throw new OrchestrationError('not_found', 'Data Drains are not enabled on this deployment')
  if (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(input.organizationId)))
    throw new OrchestrationError('forbidden', 'Data Drains are available on Enterprise plans only')
  if (roleError) {
    const read =
      operation === dataDrainOperations.list ||
      operation === dataDrainOperations.get ||
      operation === dataDrainOperations.runs
    throw new OrchestrationError(
      'forbidden',
      `Forbidden - Only organization owners and admins can ${read ? 'view' : 'manage'} data drains`
    )
  }
}

/** Organization application lifecycle; audit always derives from successful authoritative results. */
function defineDrainUseCase<
  O extends DataDrainOperation,
  I extends OrganizationInput,
  R,
>(definition: {
  operation: O
  execute(args: Execution<I>): Promise<R>
  projectAudit?(args: Execution<I> & { result: R }): WorkspaceUseCaseAuditEntry | undefined
}): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    delegationAudience: definition.operation.delegationAudience,
    async execute(args) {
      await authorizeDataDrainOperation(args.principal, definition.operation, args.input)
      const result = await definition.execute(args)
      const entry = definition.projectAudit?.({ ...args, result })
      if (entry)
        recordProjectedUseCaseAuditEntries(
          definition.operation,
          null,
          args.principal,
          args.request,
          [entry],
          args.input.organizationId
        )
      return result
    },
  }
}

function publicDrain(row: typeof dataDrains.$inferSelect): DataDrainRecord {
  return omit(row, ['destinationCredentials'])
}
async function loadDrain({ organizationId, drainId }: DrainInput) {
  const [row] = await db
    .select()
    .from(dataDrains)
    .where(and(eq(dataDrains.id, drainId), eq(dataDrains.organizationId, organizationId)))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Data drain not found')
  return row
}
function duplicateName(): never {
  throw new OrchestrationError(
    'conflict',
    'A data drain with this name already exists in this organization'
  )
}

export const listDataDrains = defineDrainUseCase({
  operation: dataDrainOperations.list,
  async execute({ input }: Execution<OrganizationInput & { limit?: number }>) {
    const query = db
      .select()
      .from(dataDrains)
      .where(eq(dataDrains.organizationId, input.organizationId))
      .orderBy(asc(dataDrains.createdAt))
    const rows =
      input.limit === undefined
        ? await query
        : await query.limit(z.number().int().min(1).max(200).parse(input.limit))
    return rows.map(publicDrain)
  },
})
export const getDataDrain = defineDrainUseCase({
  operation: dataDrainOperations.get,
  async execute({ input }: Execution<DrainInput>) {
    return publicDrain(await loadDrain(input))
  },
})
export const createDataDrain = defineDrainUseCase({
  operation: dataDrainOperations.create,
  async execute({
    principal,
    input,
  }: Execution<OrganizationInput & { body: CreateDataDrainInput }>) {
    const body = createDataDrainBodySchema.parse(input.body)
    if (!body.destinationCredentials)
      throw new OrchestrationError(
        'validation',
        'destinationCredentials is required when creating a drain'
      )
    const destination = getDestination(body.destinationType)
    const config = z
      .record(z.string(), z.unknown())
      .parse(destination.configSchema.parse(body.destinationConfig))
    const credentials = destination.credentialsSchema.parse(body.destinationCredentials)
    const encryptedCredentials = await encryptCredentials(credentials)
    const [existing] = await db
      .select({ id: dataDrains.id })
      .from(dataDrains)
      .where(
        and(eq(dataDrains.organizationId, input.organizationId), eq(dataDrains.name, body.name))
      )
      .limit(1)
    if (existing) duplicateName()
    const now = new Date()
    let inserted: typeof dataDrains.$inferSelect | undefined
    try {
      ;[inserted] = await db
        .insert(dataDrains)
        .values({
          id: generateId(),
          organizationId: input.organizationId,
          name: body.name,
          source: body.source,
          destinationType: body.destinationType,
          destinationConfig: config,
          destinationCredentials: encryptedCredentials,
          scheduleCadence: body.scheduleCadence,
          enabled: body.enabled ?? true,
          cursor: null,
          createdBy: requirePrincipalSubjectUserId(principal),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') duplicateName()
      throw error
    }
    if (!inserted) throw new Error('Insert returned no row')
    return publicDrain(inserted)
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.DATA_DRAIN_CREATED,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: result.id,
    resourceName: result.name,
    description: `Created data drain '${result.name}'`,
    metadata: {
      organizationId: input.organizationId,
      source: result.source,
      destinationType: result.destinationType,
      scheduleCadence: result.scheduleCadence,
    },
  }),
})
export const updateDataDrain = defineDrainUseCase({
  operation: dataDrainOperations.update,
  async execute({ input }: Execution<DrainInput & { body: UpdateDataDrainInput }>) {
    const body = updateDataDrainBodySchema.parse(input.body)
    const drain = await loadDrain(input)
    if (body.name !== undefined && body.name !== drain.name) {
      const [conflict] = await db
        .select({ id: dataDrains.id })
        .from(dataDrains)
        .where(
          and(
            eq(dataDrains.organizationId, input.organizationId),
            eq(dataDrains.name, body.name),
            ne(dataDrains.id, input.drainId)
          )
        )
        .limit(1)
      if (conflict) duplicateName()
    }
    if (body.source !== undefined && body.source !== drain.source)
      throw new OrchestrationError('validation', 'source cannot be changed after creation')
    if (body.destinationType !== undefined && body.destinationType !== drain.destinationType)
      throw new OrchestrationError('validation', 'destinationType cannot be changed after creation')
    const updates: Partial<typeof dataDrains.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) updates.name = body.name
    if (body.scheduleCadence !== undefined) updates.scheduleCadence = body.scheduleCadence
    if (body.enabled !== undefined) updates.enabled = body.enabled
    const destination = getDestination(drain.destinationType)
    if (body.destinationConfig !== undefined)
      updates.destinationConfig = z
        .record(z.string(), z.unknown())
        .parse(destination.configSchema.parse(body.destinationConfig))
    if (body.destinationCredentials !== undefined)
      updates.destinationCredentials = await encryptCredentials(
        destination.credentialsSchema.parse(body.destinationCredentials)
      )
    let updated: typeof dataDrains.$inferSelect | undefined
    try {
      ;[updated] = await db
        .update(dataDrains)
        .set(updates)
        .where(
          and(eq(dataDrains.id, input.drainId), eq(dataDrains.organizationId, input.organizationId))
        )
        .returning()
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') duplicateName()
      throw error
    }
    if (!updated) throw new OrchestrationError('not_found', 'Data drain not found')
    return publicDrain(updated)
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.DATA_DRAIN_UPDATED,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: result.id,
    resourceName: result.name,
    description: `Updated data drain '${result.name}'`,
    metadata: {
      changes: {
        name: input.body.name,
        source: input.body.source,
        scheduleCadence: input.body.scheduleCadence,
        enabled: input.body.enabled,
        destinationConfigChanged: input.body.destinationConfig !== undefined,
        destinationCredentialsChanged: input.body.destinationCredentials !== undefined,
      },
    },
  }),
})
export const deleteDataDrain = defineDrainUseCase({
  operation: dataDrainOperations.delete,
  async execute({ input }: Execution<DrainInput>) {
    const drain = await loadDrain(input)
    const [deleted] = await db
      .delete(dataDrains)
      .where(
        and(eq(dataDrains.id, input.drainId), eq(dataDrains.organizationId, input.organizationId))
      )
      .returning({ id: dataDrains.id })
    return { drain: publicDrain(drain), deleted: Boolean(deleted) }
  },
  projectAudit: ({ result }) =>
    result.deleted
      ? {
          action: AuditAction.DATA_DRAIN_DELETED,
          resourceType: AuditResourceType.DATA_DRAIN,
          resourceId: result.drain.id,
          resourceName: result.drain.name,
          description: `Deleted data drain '${result.drain.name}'`,
          metadata: { source: result.drain.source, destinationType: result.drain.destinationType },
        }
      : undefined,
})
export const listDataDrainRuns = defineDrainUseCase({
  operation: dataDrainOperations.runs,
  async execute({ input }: Execution<DrainInput & { limit?: number }>) {
    await loadDrain(input)
    const limit = z
      .number()
      .int()
      .min(1)
      .max(200)
      .parse(input.limit ?? 25)
    return db
      .select()
      .from(dataDrainRuns)
      .where(eq(dataDrainRuns.drainId, input.drainId))
      .orderBy(desc(dataDrainRuns.startedAt))
      .limit(limit)
  },
})
export const runDataDrain = defineDrainUseCase({
  operation: dataDrainOperations.run,
  async execute({ input }: Execution<DrainInput>) {
    const drain = await loadDrain(input)
    if (!drain.enabled)
      throw new OrchestrationError('validation', 'Cannot run a disabled drain. Enable it first.')
    const [inFlight] = await db
      .select({ id: dataDrainRuns.id })
      .from(dataDrainRuns)
      .where(and(eq(dataDrainRuns.drainId, input.drainId), eq(dataDrainRuns.status, 'running')))
      .limit(1)
    if (inFlight)
      throw new OrchestrationError('conflict', 'A run is already in progress for this drain')
    const queue = await getJobQueue()
    const jobId = await queue.enqueue(
      'run-data-drain',
      { drainId: drain.id, trigger: 'manual' },
      { concurrencyKey: `data-drain:${drain.id}` }
    )
    return { jobId, drain: publicDrain(drain) }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.DATA_DRAIN_RAN,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: result.drain.id,
    resourceName: result.drain.name,
    description: `Triggered manual run for data drain '${result.drain.name}'`,
    metadata: { jobId: result.jobId, trigger: 'manual' },
  }),
})
export const testDataDrain = defineDrainUseCase({
  operation: dataDrainOperations.test,
  async execute({ input }: Execution<DrainInput>) {
    const drain = await loadDrain(input)
    const destination = getDestination(drain.destinationType)
    const test = destination.test
    if (!test)
      throw new OrchestrationError(
        'validation',
        `Destination '${drain.destinationType}' does not support connection testing`
      )
    const config = destination.configSchema.parse(drain.destinationConfig)
    const credentials = destination.credentialsSchema.parse(
      await decryptCredentials(drain.destinationCredentials)
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      await runWithOutboundOrganization(drain.organizationId, () =>
        test({ config, credentials, signal: controller.signal })
      )
      return { drain: publicDrain(drain), ok: true as const }
    } catch (error) {
      const message = toError(error).message
      logger.warn('Data drain test connection failed', {
        drainId: drain.id,
        destinationType: drain.destinationType,
        error: message,
      })
      return { drain: publicDrain(drain), ok: false as const, error: message }
    } finally {
      clearTimeout(timeout)
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.DATA_DRAIN_TESTED,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: result.drain.id,
    resourceName: result.drain.name,
    description: `Tested connection for data drain '${result.drain.name}' (${result.ok ? 'success' : 'failed'})`,
    metadata: {
      destinationType: result.drain.destinationType,
      outcome: result.ok ? 'success' : 'failed',
      ...(!result.ok ? { error: result.error } : {}),
    },
  }),
})
