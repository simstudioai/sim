import { filterUndefined } from '@sim/utils/object'
import { z } from 'zod'
import type { PlanetScaleCredentials, PlanetScaleScope } from '@/tools/planetscale/types'
import type { ToolRetryConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const PLANETSCALE_API_ORIGIN = 'https://api.planetscale.com'

export const PLANETSCALE_READ_RETRY: ToolRetryConfig = { enabled: true, maxRetries: 3 }

export const planetScaleDatabaseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    state: z.string(),
    ready: z.boolean(),
    default_branch: z.string(),
    branches_count: z.number().int(),
    deletion_protected: z.boolean(),
    require_approval_for_deploy: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    html_url: z.string(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    kind: data.kind,
    state: data.state,
    ready: data.ready,
    defaultBranch: data.default_branch,
    branchesCount: data.branches_count,
    deletionProtected: data.deletion_protected,
    requireApprovalForDeploy: data.require_approval_for_deploy,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    htmlUrl: data.html_url,
  }))

export const planetScaleBranchSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    state: z.string(),
    ready: z.boolean(),
    production: z.boolean(),
    safe_migrations: z.boolean(),
    deletion_protected: z.boolean(),
    parent_branch: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    created_at: z.string(),
    updated_at: z.string(),
    html_url: z.string(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    kind: data.kind,
    state: data.state,
    ready: data.ready,
    production: data.production,
    safeMigrations: data.safe_migrations,
    deletionProtected: data.deletion_protected,
    parentBranch: data.parent_branch,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    htmlUrl: data.html_url,
  }))

export const planetScaleBackupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    size: z.number().int(),
    estimated_storage_cost: z.number(),
    protected: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    started_at: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    completed_at: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    expires_at: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    state: data.state,
    size: data.size,
    estimatedStorageCost: data.estimated_storage_cost,
    protected: data.protected,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    expiresAt: data.expires_at,
  }))

export const planetScaleDeployRequestSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    branch: z.string(),
    into_branch: z.string(),
    state: z.string(),
    deployment_state: z.string(),
    approved: z.boolean(),
    num_comments: z.number().int(),
    notes: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    closed_at: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    deployed_at: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    html_url: z.string(),
  })
  .transform((data) => ({
    id: data.id,
    number: data.number,
    branch: data.branch,
    intoBranch: data.into_branch,
    state: data.state,
    deploymentState: data.deployment_state,
    approved: data.approved,
    numComments: data.num_comments,
    notes: data.notes,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    closedAt: data.closed_at,
    deployedAt: data.deployed_at,
    htmlUrl: data.html_url,
  }))

export const planetScaleReviewSchema = z
  .object({
    id: z.string(),
    state: z.string(),
    body: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((data) => ({
    id: data.id,
    state: data.state,
    body: data.body,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }))

export const planetScalePaginationSchema = z
  .object({
    current_page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    next_page: z.number().int().positive().nullable(),
    total_count: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
  })
  .transform((data) => ({
    currentPage: data.current_page,
    perPage: data.per_page,
    nextPage: data.next_page,
    totalCount: data.total_count,
    totalPages: data.total_pages,
  }))

export function planetScaleHeaders(credentials: PlanetScaleCredentials): Record<string, string> {
  for (const value of [credentials.serviceTokenId, credentials.serviceToken]) {
    if (typeof value !== 'string' || !/^[\x21-\x7e]+$/.test(value) || value.includes(':'))
      throw new Error('Invalid PlanetScale service token credentials')
  }
  return {
    Authorization: `${credentials.serviceTokenId}:${credentials.serviceToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}
export function planetScaleOrganizationPath(organization: string): string {
  return `/organizations/${safeUrlPathSegment(organization, 'organization')}`
}
export function planetScaleDatabasePath(params: PlanetScaleScope): string {
  return `${planetScaleOrganizationPath(params.organization)}/databases/${safeUrlPathSegment(params.database ?? '', 'database')}`
}
export function planetScaleBranchPath(params: PlanetScaleScope): string {
  return `${planetScaleDatabasePath(params)}/branches/${safeUrlPathSegment(params.branch ?? '', 'branch')}`
}
export function optionalPlanetScaleString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}
export function optionalPlanetScaleBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}
export function optionalPlanetScaleInteger(
  value: unknown,
  name: string,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${name} must be an integer of at least ${minimum}`)
  if (value > maximum) throw new Error(`${name} must be at most ${maximum}`)
  return value
}
export function planetScaleNumber(value: unknown, name: string): number {
  const number = optionalPlanetScaleInteger(value, name)
  if (number === undefined) throw new Error(`${name} is required`)
  return number
}
export function optionalPlanetScaleEnum(
  value: unknown,
  name: string,
  allowed: readonly string[]
): string | undefined {
  const text = optionalPlanetScaleString(value, name)
  if (text !== undefined && !allowed.includes(text))
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`)
  return text
}
export function planetScaleApiUrl(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
): string {
  const url = new URL(`/v1${path}`, PLANETSCALE_API_ORIGIN)
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) url.searchParams.set(key, String(value))
  return url.toString()
}
export function planetScaleBody(body: Record<string, unknown>): Record<string, unknown> {
  return filterUndefined(body)
}
export async function planetScaleJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json()
  return body
}
