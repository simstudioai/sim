import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { groupToken, sortAccessTokens, userToken } from '@/lib/knowledge/access/tokens'
import { LINK_ACCESS_TOKEN } from '@/lib/knowledge/access/types'
import {
  type CodaDoc,
  codaEmailSchema,
  codaIdSchema,
  codaJson,
  codaListSchema,
  codaPages,
} from '@/connectors/coda/client'
import { codaOrganizationPath, codaSourceConfig } from '@/connectors/coda/config'
import { codaDocumentPath, readCodaDoc } from '@/connectors/coda/source'
import type {
  ConnectorConfig,
  ConnectorDirectory,
  ConnectorDirectoryGroup,
} from '@/connectors/types'

const logger = createLogger('CodaPermissions')
const MAX_DIRECTORY_ENTRIES = 100_000
const permissionSchema = z.object({
  access: z.string().max(64),
  principal: z.object({
    type: z.string().max(64),
    email: codaEmailSchema.optional(),
    groupId: codaIdSchema.optional(),
    workspaceId: codaIdSchema.optional(),
    domain: z.string().max(253).optional(),
  }),
})
const namedSchema = z.object({ id: codaIdSchema })
const memberSchema = z.object({ email: codaEmailSchema })
const orgUserSchema = memberSchema.extend({ status: z.enum(['Active', 'Deactivated', 'Deleted']) })

function directoryToken(organizationId: string, id: string): string {
  const token = groupToken({ providerId: 'coda', tenantId: organizationId, groupId: id })
  if (!token) throw new Error('Coda returned an invalid permission principal')
  return token
}

/**
 * Link possession and unsupported audiences never become workspace-wide grants.
 * Opaque Coda IDs use hex so shared email-oriented group normalization cannot merge case-distinct IDs.
 */
export function codaPermissionTokens(
  permissions: readonly z.infer<typeof permissionSchema>[],
  owner?: string,
  organizationId?: string
): string[] {
  const tokens = new Set<string>()
  const addPerson = (email?: string) => {
    const token = userToken(email)
    if (token)
      tokens.add(organizationId ? directoryToken(organizationId, `user:${token.slice(2)}`) : token)
  }
  addPerson(owner)
  for (const { access, principal } of permissions) {
    if (!['readonly', 'comment', 'write'].includes(access)) continue
    if (principal.type === 'email') addPerson(principal.email)
    else if (principal.type === 'anyone') tokens.add(LINK_ACCESS_TOKEN)
    else if (organizationId) {
      const id =
        principal.type === 'group' && principal.groupId
          ? `group:${Buffer.from(principal.groupId).toString('hex')}`
          : principal.type === 'workspace' && principal.workspaceId
            ? `workspace:${Buffer.from(principal.workspaceId).toString('hex')}`
            : principal.type === 'domain' && principal.domain
              ? `domain:${principal.domain.toLowerCase()}`
              : undefined
      if (id) tokens.add(directoryToken(organizationId, id))
    }
  }
  return sortAccessTokens(tokens)
}

/** Reads the entire ACL afresh even when the document body has not changed. */
export async function readCodaDocAcl(token: string, docId: string, organizationId?: string) {
  const doc = await readCodaDoc(token, docId, organizationId)
  const path = codaDocumentPath(doc, organizationId)
  if (doc.isDeleted || doc.keyAccessRevoked) return []
  const permissions: z.infer<typeof permissionSchema>[] = []
  for await (const page of codaPages(
    token,
    `${path}/acl/permissions`,
    permissionSchema,
    undefined,
    Boolean(organizationId)
  )) {
    if (permissions.length + page.length > 5000)
      throw new Error('Coda document exceeded the permission limit')
    permissions.push(...page)
  }
  return codaPermissionTokens(permissions, doc.owner, organizationId)
}

export const resolveCodaAcls: NonNullable<ConnectorConfig['getDocumentAcls']> = async (
  token,
  config,
  documents,
  context
) => {
  const { docIds, organizationId } = codaSourceConfig(config, context)
  const groups = new Map<string, string[]>()
  for (const document of documents) {
    const docId = document.externalId.split('/')[0]
    if (!codaIdSchema.safeParse(docId).success || (docIds.length && !docIds.includes(docId)))
      continue
    const entries = groups.get(docId) ?? []
    entries.push(document.externalId)
    groups.set(docId, entries)
  }
  const result: Record<string, string[]> = {}
  for (const [docId, externalIds] of groups) {
    try {
      const acl = await readCodaDocAcl(token, docId, organizationId)
      for (const externalId of externalIds) result[externalId] = acl
    } catch (error) {
      logger.warn('Coda document permissions could not be verified', {
        docId,
        error: getErrorMessage(error),
      })
    }
  }
  return result
}

/** Admin-only preflight keeps source setup from silently falling back to personal discovery. */
export async function validateCodaAdminAccess(token: string, organizationId: string) {
  const root = codaOrganizationPath(organizationId)
  const organization = await codaJson(token, root, namedSchema, undefined, true, true)
  if (organization.id !== organizationId) throw new Error('Coda returned a different organization')
  for (const collection of ['groups', 'workspaces', 'users'] as const) {
    await codaJson(
      token,
      `${root}/${collection}`,
      codaListSchema(collection === 'users' ? orgUserSchema : namedSchema),
      { limit: 1 },
      true,
      true
    )
  }
}

/** Opens without reading memberships; snapshots are collected only under the directory lease. */
export function openCodaDirectory(token: string, organizationId: string): ConnectorDirectory {
  const root = codaOrganizationPath(organizationId)
  let people: Map<string, boolean> | undefined
  const domains = new Map<string, string[]>()

  async function readPeople() {
    const result = new Map<string, boolean>()
    for await (const page of codaPages(token, `${root}/users`, orgUserSchema, undefined, true)) {
      for (const person of page) {
        if (result.size >= MAX_DIRECTORY_ENTRIES)
          throw new Error('Coda directory exceeded its user limit')
        const email = person.email.trim().toLowerCase()
        /** A duplicate identity with conflicting status is never activated by response order. */
        result.set(email, (result.get(email) ?? true) && person.status === 'Active')
      }
    }
    domains.clear()
    for (const [email, active] of result) {
      const domain = email.split('@')[1]
      const members = domains.get(domain) ?? []
      if (active) members.push(email)
      domains.set(domain, members)
    }
    people = result
    return result
  }

  return {
    providerId: 'coda',
    tenantId: organizationId,
    listGroups: async () => {
      const users = await readPeople()
      const groups: ConnectorDirectoryGroup[] = []
      const append = (id: string) => {
        if (groups.length >= MAX_DIRECTORY_ENTRIES)
          throw new Error('Coda directory exceeded its group limit')
        groups.push({ id })
      }
      for (const email of users.keys()) append(`user:${email}`)
      for (const domain of domains.keys()) append(`domain:${domain}`)
      for (const [collection, prefix] of [
        ['groups', 'group'],
        ['workspaces', 'workspace'],
      ] as const) {
        for await (const page of codaPages(
          token,
          `${root}/${collection}`,
          namedSchema,
          undefined,
          true
        )) {
          for (const group of page) append(`${prefix}:${Buffer.from(group.id).toString('hex')}`)
        }
      }
      return groups
    },
    listGroupMembers: async (group) => {
      const users = people ?? (await readPeople())
      const memberTokens = new Set<string>()
      const add = (email: string) => {
        const normalized = email.trim().toLowerCase()
        if (users.get(normalized) === false) return
        const token = userToken(normalized)
        if (!token) throw new Error('Coda returned an invalid directory member')
        if (memberTokens.size >= MAX_DIRECTORY_ENTRIES)
          throw new Error('Coda group exceeded its member limit')
        memberTokens.add(token)
      }
      const separator = group.id.indexOf(':')
      const kind = group.id.slice(0, separator)
      const id = group.id.slice(separator + 1)
      if (kind === 'user') {
        if (users.get(id) === true) add(id)
      } else if (kind === 'domain') {
        for (const email of domains.get(id) ?? []) add(email)
      } else if (kind === 'group' || kind === 'workspace') {
        if (!/^(?:[0-9a-f]{2})+$/.test(id)) throw new Error('Invalid Coda directory ID')
        const resourceId = codaIdSchema.parse(Buffer.from(id, 'hex').toString('utf8'))
        const path = `${root}/${kind === 'group' ? 'groups' : 'workspaces'}/${encodeURIComponent(resourceId)}/${kind === 'group' ? 'members' : 'users'}`
        for await (const page of codaPages(token, path, memberSchema, undefined, true)) {
          for (const member of page) add(member.email)
        }
      } else throw new Error('Unrecognized Coda directory group')
      return { group, memberTokens: sortAccessTokens(memberTokens), complete: true }
    },
  }
}

/** Setup probes endpoint access; synchronization separately drains the complete ACL. */
export async function validateCodaDocPermissions(
  token: string,
  doc: CodaDoc,
  organizationId?: string
) {
  const path = codaDocumentPath(doc, organizationId)
  await codaJson(
    token,
    `${path}/acl/permissions`,
    codaListSchema(permissionSchema),
    { limit: 1 },
    true,
    Boolean(organizationId)
  )
}
