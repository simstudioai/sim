import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, organization, user, workspace } from '@sim/db/schema'
import { and, asc, eq, gt, ilike, isNull, or } from 'drizzle-orm'
import {
  authorizeBenchmarkTarget,
  canUseBenchmarks,
  defineAuthorizedBenchmarkUseCase,
} from '@/lib/benchmarks/application/access'
import { requireBenchmarkSourceAccess } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'
import { canCreateOrganizationWorkspace } from '@/lib/workspaces/policy'

const PAGE_SIZE = 50
interface SelectionInput {
  organizationId?: string
  search: string
  cursor?: string
  selectedId?: string
}

function page<T extends { id: string }>(rows: T[]) {
  return {
    items: rows.slice(0, PAGE_SIZE),
    nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : null,
  }
}

export const benchmarkAvailability = {
  operation: benchmarkOperations.availability,
  async execute({ principal }: { principal: Principal; input: Record<string, never> }) {
    return { available: principal.kind === 'session' && (await canUseBenchmarks(principal.userId)) }
  },
}

export const listBenchmarkOrganizations = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.organizations,
  async execute({ input }: { input: SelectionInput }) {
    const result = page(
      await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(
          and(
            input.cursor ? gt(organization.id, input.cursor) : undefined,
            input.search
              ? or(ilike(organization.name, `%${input.search}%`), eq(organization.id, input.search))
              : undefined
          )
        )
        .orderBy(asc(organization.id))
        .limit(PAGE_SIZE + 1)
    )
    const [selected] = input.selectedId
      ? await db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(eq(organization.id, input.selectedId))
          .limit(1)
      : []
    return {
      organizations: result.items,
      selected: selected ?? null,
      nextCursor: result.nextCursor,
    }
  },
})

export const listBenchmarkUsers = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.users,
  async execute({ input }: { input: SelectionInput & { organizationId: string } }) {
    const result = page(
      await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(member.organizationId, input.organizationId),
            or(eq(user.banned, false), isNull(user.banned)),
            input.cursor ? gt(user.id, input.cursor) : undefined,
            input.search
              ? or(
                  ilike(user.name, `%${input.search}%`),
                  ilike(user.email, `%${input.search}%`),
                  eq(user.id, input.search)
                )
              : undefined
          )
        )
        .orderBy(asc(user.id))
        .limit(PAGE_SIZE + 1)
    )
    const [selected] = input.selectedId
      ? await db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(
            and(
              eq(member.organizationId, input.organizationId),
              eq(user.id, input.selectedId),
              or(eq(user.banned, false), isNull(user.banned))
            )
          )
          .limit(1)
      : []
    return { users: result.items, selected: selected ?? null, nextCursor: result.nextCursor }
  },
})

export const listBenchmarkWorkspaces = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.workspaces,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: SelectionInput & { organizationId: string; runAsUserId: string }
  }) {
    const target = await authorizeBenchmarkTarget(principal, input)
    const result = page(
      await db
        .select({ id: workspace.id, name: workspace.name })
        .from(workspace)
        .where(
          and(
            eq(workspace.organizationId, input.organizationId),
            isNull(workspace.archivedAt),
            input.cursor ? gt(workspace.id, input.cursor) : undefined,
            input.search
              ? or(ilike(workspace.name, `%${input.search}%`), eq(workspace.id, input.search))
              : undefined
          )
        )
        .orderBy(asc(workspace.id))
        .limit(PAGE_SIZE + 1)
    )
    const workspaces: typeof result.items = []
    for (const candidate of result.items) {
      try {
        await requireBenchmarkSourceAccess(
          principal,
          input.organizationId,
          candidate.id,
          input.runAsUserId
        )
        workspaces.push(candidate)
      } catch (error) {
        if (
          !(error instanceof OrchestrationError) ||
          !['forbidden', 'not_found'].includes(error.code)
        )
          throw error
      }
    }
    const config = await getUserPermissionConfigForOrganization(target.organizationId)
    return {
      workspaces,
      nextCursor: result.nextCursor,
      canPlan:
        canCreateOrganizationWorkspace(target.role, config) &&
        (await canUseBenchmarks(target.userId)),
    }
  },
})
