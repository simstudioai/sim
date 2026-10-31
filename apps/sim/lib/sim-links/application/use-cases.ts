import { AuditAction, AuditResourceType } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import type { WorkspaceUseCaseAuditEntry } from '@/lib/core/application/authorized-workspace-use-case'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import type { DbTransaction } from '@/lib/db/types'
import { simLinkOperations } from '@/lib/sim-links/application/operations'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import { resolveSimLinkTarget, type SimLinkTarget } from '@/lib/sim-links/destination'
import { requireSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import type { SimLinkAccess, SimLinkRecord, SimLinkViewer } from '@/lib/sim-links/repository'
import * as repository from '@/lib/sim-links/repository'
import {
  normalizeSimLinkName,
  parseTypedSimLink,
  type SimLinkFields,
  type SimLinkSort,
  stripSimLinkPrefix,
} from '@/lib/sim-links/validation'
import type { SortDirection } from '@/lib/url-state'

const logger = createLogger('SimLinks')

interface OrganizationInput {
  organizationId: string
}
interface LinkInput extends OrganizationInput {
  linkId: string
}

export interface SimLinkView extends SimLinkRecord {
  canEdit: boolean
  canManage: boolean
}

export type SimLinkResolution = SimLinkTarget | { kind: 'not_found' }

const rollout = {
  authorizeResource: ({ context }: { context: OrganizationMembershipContext }) =>
    requireSimLinksEnabled(context.organizationId),
}

function viewerOf(context: OrganizationMembershipContext): SimLinkViewer {
  return { userId: context.userId, isAdmin: isOrgAdminRole(context.role) }
}

/** The creator and organization admins decide who may find and edit a link. */
function canManage(createdBy: string | null, viewer: SimLinkViewer): boolean {
  return viewer.isAdmin || createdBy === viewer.userId
}

function canEdit(restrictEdit: boolean, createdBy: string | null, viewer: SimLinkViewer) {
  return !restrictEdit || canManage(createdBy, viewer)
}

function toView(record: SimLinkRecord, viewer: SimLinkViewer): SimLinkView {
  const createdBy = record.createdBy?.id ?? null
  return {
    ...record,
    canEdit: canEdit(record.restrictEdit, createdBy, viewer),
    canManage: canManage(createdBy, viewer),
  }
}

/** Locks the link and refuses an edit its current access does not allow. */
async function lockEditableSimLink(
  tx: DbTransaction,
  { organizationId, linkId }: LinkInput,
  viewer: SimLinkViewer
): Promise<SimLinkAccess> {
  const access = await repository.lockSimLinkAccess(tx, organizationId, linkId)
  if (!access) throw new OrchestrationError('not_found', 'Sim link not found')
  if (!canEdit(access.restrictEdit, access.createdBy, viewer)) {
    throw new OrchestrationError(
      'forbidden',
      'Only the creator or an organization admin can edit this Sim link'
    )
  }
  return access
}

/** Names match case- and punctuation-insensitively, so the clash may be spelled differently. */
async function withUniqueName<T>(
  organizationId: string,
  name: string,
  write: () => Promise<T>
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (getPostgresErrorCode(error) !== '23505') throw error
    const existing = await repository.findSimLinkDestination(organizationId, name)
    throw new OrchestrationError('conflict', `sim/${existing?.name ?? name} already exists`)
  }
}

/** The audit entry for a link `verb`ed by this operation, named as members type it. */
function auditOf(
  action: WorkspaceUseCaseAuditEntry['action'],
  verb: string,
  link: { id: string; name: string },
  metadata?: Record<string, unknown>
): WorkspaceUseCaseAuditEntry {
  return {
    action,
    resourceType: AuditResourceType.SIM_LINK,
    resourceId: link.id,
    resourceName: `sim/${link.name}`,
    description: `${verb} sim/${link.name}`,
    metadata,
  }
}

/** What a saved link now does, for its audit entry. */
function savedMetadata(link: SimLinkView): Record<string, unknown> {
  return {
    url: link.url,
    defaultUrl: link.defaultUrl,
    unlisted: link.unlisted,
    restrictEdit: link.restrictEdit,
  }
}

/** Read in the writing transaction, so the result and its audit describe exactly this write. */
async function readView(
  tx: DbTransaction,
  organizationId: string,
  linkId: string,
  viewer: SimLinkViewer
) {
  const record = await repository.getSimLink(tx, organizationId, linkId)
  if (!record) throw new OrchestrationError('not_found', 'Sim link not found')
  return toView(record, viewer)
}

export const listSimLinks = defineAuthorizedOrganizationUseCase({
  operation: simLinkOperations.list,
  ...rollout,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<
    OrganizationInput & {
      search?: string
      cursor?: string
      sort?: SimLinkSort
      dir?: SortDirection
    }
  >) {
    const viewer = viewerOf(context)
    const page = await repository.listSimLinks(context.organizationId, viewer, input)
    return {
      links: page.links.map((record) => toView(record, viewer)),
      nextCursor: page.nextCursor,
    }
  },
})

export const createSimLink = defineAuthorizedOrganizationUseCase({
  operation: simLinkOperations.create,
  ...rollout,
  async execute({ input, context }: OrganizationUseCaseContext<OrganizationInput & SimLinkFields>) {
    const { organizationId, ...fields } = input
    return withUniqueName(organizationId, fields.name, () =>
      db.transaction(async (tx) => {
        const linkId = await repository.insertSimLink(tx, organizationId, context.userId, fields)
        return readView(tx, organizationId, linkId, viewerOf(context))
      })
    )
  },
  projectAudit: ({ result }) =>
    auditOf(AuditAction.SIM_LINK_CREATED, 'Created', result, savedMetadata(result)),
})

export const updateSimLink = defineAuthorizedOrganizationUseCase({
  operation: simLinkOperations.update,
  ...rollout,
  async execute({ input, context }: OrganizationUseCaseContext<LinkInput & SimLinkFields>) {
    const { organizationId, linkId, ...fields } = input
    const viewer = viewerOf(context)
    return withUniqueName(organizationId, fields.name, () =>
      db.transaction(async (tx) => {
        const access = await lockEditableSimLink(tx, input, viewer)
        if (
          (fields.unlisted !== access.unlisted || fields.restrictEdit !== access.restrictEdit) &&
          !canManage(access.createdBy, viewer)
        ) {
          throw new OrchestrationError(
            'forbidden',
            'Only the creator or an organization admin can change who finds or edits this Sim link'
          )
        }
        await repository.updateSimLink(tx, organizationId, linkId, fields)
        return readView(tx, organizationId, linkId, viewer)
      })
    )
  },
  projectAudit: ({ result }) =>
    auditOf(AuditAction.SIM_LINK_UPDATED, 'Updated', result, savedMetadata(result)),
})

export const deleteSimLink = defineAuthorizedOrganizationUseCase({
  operation: simLinkOperations.delete,
  ...rollout,
  async execute({ input, context }: OrganizationUseCaseContext<LinkInput>) {
    return db.transaction(async (tx) => {
      const { name } = await lockEditableSimLink(tx, input, viewerOf(context))
      await repository.deleteSimLink(tx, input.organizationId, input.linkId)
      return { id: input.linkId, name }
    })
  },
  projectAudit: ({ result }) => auditOf(AuditAction.SIM_LINK_DELETED, 'Deleted', result),
})

/** Visit counts rank links; failing to record one must never block the redirect it describes. */
async function countVisit(organizationId: string, linkId: string): Promise<void> {
  try {
    await repository.recordSimLinkVisit(organizationId, linkId)
  } catch (error) {
    logger.warn('Could not count a Sim link visit', {
      organizationId,
      linkId,
      error: toError(error),
    })
  }
}

/**
 * Unlisted links resolve for every member: unlisting hides a link from browsing, not from use.
 * Only a redirect counts as a visit; a link opened without the values it needs does not.
 * `query` is the typed `?…` string, carried to the destination.
 */
export const resolveSimLink = defineAuthorizedOrganizationUseCase({
  operation: simLinkOperations.resolve,
  ...rollout,
  async execute({
    input,
  }: OrganizationUseCaseContext<
    OrganizationInput & { name: string; values: readonly string[]; query: string }
  >): Promise<SimLinkResolution> {
    const link = await repository.findSimLinkDestination(input.organizationId, input.name)
    if (!link) return { kind: 'not_found' }
    const target = resolveSimLinkTarget(link, input.values, input.query)
    if (target.kind === 'redirect') await countVisit(input.organizationId, link.id)
    return target
  },
})

/** The name in what was typed after the `sim` keyword: `sim/jira/ABC-1?x` suggests from `jira`. */
function typedNamePrefix(query: string): string {
  const [path = ''] = stripSimLinkPrefix(query.trim()).split('?')
  return normalizeSimLinkName(parseTypedSimLink(path.split('/')).name)
}

/**
 * Address-bar suggestions from the organization `sim/` opens in for this session, so every
 * suggestion resolves where it is followed. Nothing is suggested where Sim links are off.
 */
export const suggestSimLinks = defineAuthorizedCredentialUserUseCase({
  operation: simLinkOperations.suggest,
  async execute({ principal, input }: { principal: SessionPrincipal; input: { query: string } }) {
    const organizationId = await resolveSimLinkOrganization(principal)
    if (!organizationId) return []
    return repository.suggestSimLinks(organizationId, typedNamePrefix(input.query))
  },
})
