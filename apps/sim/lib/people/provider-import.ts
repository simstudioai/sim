import { sha256Hex } from '@sim/security/hash'
import { compareStrings, normalizeEmail } from '@sim/utils/string'
import { z } from 'zod'
import { PEOPLE_IMPORT_MAX_ROWS, type PeopleImportBody } from '@/lib/api/contracts/people'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import {
  checkedDirectoryNextLink,
  MAX_NEXT_LINK_LENGTH,
  readDirectoryResponse,
} from '@/lib/people/sync/provider-request'
import type { DirectoryPerson } from '@/lib/people/sync/types'
import { DIRECTORY_TEXT_MAX_LENGTH } from '@/lib/people/validation'

type ProviderInput = Extract<PeopleImportBody, { source: 'okta' | 'entra' }>

const PAGE_SIZE = 200
const MAX_PAGES = 100
const MAX_IMPORT_PROFILE_BYTES = 32 * 1024 * 1024
const IMPORT_TIMEOUT_MS = 60_000
const optionalText = z.string().trim().max(DIRECTORY_TEXT_MAX_LENGTH).nullish()
const id = z.string().min(1).max(512)
const oktaPage = z
  .array(
    z.object({
      id,
      status: z.string(),
      profile: z.object({
        displayName: optionalText.catch(null),
        firstName: optionalText.catch(null),
        lastName: optionalText.catch(null),
        email: optionalText,
        login: optionalText,
        title: optionalText,
        department: optionalText,
        city: optionalText,
        state: optionalText,
        countryCode: optionalText,
        managerId: optionalText,
      }),
    })
  )
  .max(PAGE_SIZE)
const entraPage = z.object({
  value: z
    .array(
      z.object({
        id,
        accountEnabled: z.boolean(),
        displayName: optionalText.catch(null),
        mail: optionalText,
        userPrincipalName: optionalText,
        jobTitle: optionalText,
        department: optionalText,
        officeLocation: optionalText,
        manager: z.object({ id }).nullish(),
      })
    )
    .max(PAGE_SIZE),
  '@odata.nextLink': z.string().min(1).max(MAX_NEXT_LINK_LENGTH).optional(),
})

type DirectoryAccess =
  | { source: 'okta'; domain: string; token: string }
  | { source: 'entra'; token: string }

function usersEndpoint(input: DirectoryAccess, appOnly: boolean): URL {
  if (input.source === 'entra') {
    const url = new URL('https://graph.microsoft.com/v1.0/users')
    url.searchParams.set(
      '$select',
      'id,displayName,mail,userPrincipalName,accountEnabled,jobTitle,department,officeLocation'
    )
    if (appOnly) url.searchParams.set('$filter', 'accountEnabled eq true')
    else url.searchParams.set('$expand', 'manager($select=id)')
    url.searchParams.set('$top', String(PAGE_SIZE))
    return url
  }
  const url = new URL(`https://${oktaDirectoryHost(input.domain)}/api/v1/users`)
  url.searchParams.set('filter', 'status eq "ACTIVE"')
  url.searchParams.set('limit', String(PAGE_SIZE))
  return url
}

/** Only HTTPS Okta tenant hosts can receive directory credentials. */
export function oktaDirectoryHost(domain: string): string {
  try {
    const normalized = domain.trim().toLowerCase()
    if (normalized.startsWith('http://')) throw new Error()
    return validateOktaDomain(normalized)
  } catch {
    throw new OrchestrationError(
      'validation',
      'Enter your HTTPS Okta organization domain, such as example.okta.com.'
    )
  }
}

function oktaNextLink(header: string | null): string | undefined {
  if (header === null) return undefined
  let next: string | undefined
  for (const part of header.split(/,\s*(?=<)/)) {
    const link = /^\s*<([^<>]+)>\s*;(.*)$/.exec(part)
    const relation = link && /(?:^|;)\s*rel\s*=\s*(?:"([^"]+)"|([\w.-]+))\s*(?:;|$)/i.exec(link[2])
    if (!link || !relation)
      throw new OrchestrationError('validation', 'Okta returned an invalid pagination link.')
    if (!(relation[1] ?? relation[2]).toLowerCase().split(/\s+/).includes('next')) continue
    if (next)
      throw new OrchestrationError(
        'validation',
        'Okta returned more than one next pagination link.'
      )
    next = link[1]
  }
  return next
}

function parseDirectoryPage(source: ProviderInput['source'], data: unknown, link: string | null) {
  if (source === 'entra') {
    const page = entraPage.safeParse(data)
    if (!page.success)
      throw new OrchestrationError(
        'validation',
        'Microsoft Graph returned an incomplete directory page. Check User.Read.All access.'
      )
    const profiles: DirectoryPerson[] = page.data.value
      .filter((person) => person.accountEnabled)
      .map((person) => ({
        externalId: person.id,
        name: person.displayName || person.mail || person.userPrincipalName || person.id,
        email: normalizeEmail(person.mail || person.userPrincipalName || ''),
        title: person.jobTitle || null,
        department: person.department || null,
        location: person.officeLocation || null,
        managerExternalId: person.manager?.id ?? null,
      }))
    return { profiles, next: page.data['@odata.nextLink'] }
  }
  const page = oktaPage.safeParse(data)
  if (!page.success)
    throw new OrchestrationError('validation', 'Okta returned an incomplete directory page.')
  const profiles: DirectoryPerson[] = page.data
    .filter((person) => person.status === 'ACTIVE')
    .map(({ id, profile }) => ({
      externalId: id,
      name:
        profile.displayName ||
        [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
        profile.email ||
        profile.login ||
        id,
      email: normalizeEmail(profile.email || profile.login || ''),
      title: profile.title || null,
      department: profile.department || null,
      location:
        [profile.city, profile.state, profile.countryCode].filter(Boolean).join(', ') || null,
      managerExternalId: profile.managerId || null,
    }))
  return { profiles, next: oktaNextLink(link) }
}

/** Reads one page and validates both the saved checkpoint and the provider's proposed continuation. */
export function externalDirectoryUsers(input: DirectoryAccess, appOnly = false) {
  const endpoint = usersEndpoint(input, appOnly)
  const authorization = `${input.source === 'okta' ? 'SSWS' : 'Bearer'} ${input.token}`
  return {
    sourceId: endpoint.origin,
    async users(cursor: string | null, signal?: AbortSignal) {
      const url = cursor === null ? endpoint : checkedDirectoryNextLink(cursor, endpoint)
      const { data, link } = await readDirectoryResponse(url, {
        signal,
        headers: { Authorization: authorization, Accept: 'application/json' },
      })
      const page = parseDirectoryPage(input.source, data, link)
      const next = page.next ? checkedDirectoryNextLink(page.next, endpoint).href : null
      if (next === url.href)
        throw new OrchestrationError('validation', 'The directory repeated its pagination link.')
      if (appOnly) for (const person of page.profiles) person.managerExternalId = null
      return { people: page.profiles, next }
    },
  }
}

export async function readProviderProfiles(input: ProviderInput & { organizationId: string }) {
  const reader = externalDirectoryUsers(input)
  const signal = AbortSignal.timeout(IMPORT_TIMEOUT_MS)
  const seen = new Set<string | null>()
  const profiles = new Map<string, DirectoryPerson>()
  let bytes = 0
  let cursor: string | null = null
  do {
    if (seen.has(cursor) || seen.size >= MAX_PAGES)
      throw new OrchestrationError(
        'validation',
        'Directory pagination did not finish. Use Directory sync for a large directory.'
      )
    seen.add(cursor)
    const page = await reader.users(cursor, signal)
    if (profiles.size + page.people.length > PEOPLE_IMPORT_MAX_ROWS)
      throw new OrchestrationError(
        'validation',
        'One-time imports support up to 10,000 people. Use Directory sync for a larger directory.'
      )
    for (const person of page.people) {
      if (profiles.has(person.externalId))
        throw new OrchestrationError(
          'validation',
          'The directory changed during pagination. Try the import again.'
        )
      bytes += Buffer.byteLength(JSON.stringify(person))
      if (bytes > MAX_IMPORT_PROFILE_BYTES)
        throw new OrchestrationError(
          'validation',
          'This directory exceeds the one-time import size limit. Use Directory sync or import a smaller file.'
        )
      profiles.set(person.externalId, person)
    }
    cursor = page.next
  } while (cursor !== null)
  const ordered = [...profiles.values()].sort(
    (left, right) =>
      compareStrings(left.email, right.email) || compareStrings(left.externalId, right.externalId)
  )
  const rows = ordered.map((person) => {
    const row: Record<string, string> = { email: person.email }
    if (person.title) row.title = person.title
    if (person.department) row.department = person.department
    if (person.location) row.location = person.location
    if (person.managerExternalId)
      row.managerEmail =
        profiles.get(person.managerExternalId)?.email || '(unavailable in this directory)'
    return row
  })
  return {
    headers: ['email', 'title', 'department', 'location', 'managerEmail'],
    rows,
    sourceId: reader.sourceId,
  }
}

/** Binds confirmation to the same organization, connection and projected directory rows as the preview. */
export function verifyDirectoryPreview(
  input: Extract<PeopleImportBody, { source: string }> & { organizationId: string },
  sourceId: string,
  rows: readonly Record<string, string>[]
): string {
  const previewDigest = sha256Hex(
    JSON.stringify([
      input.organizationId,
      input.source,
      sourceId,
      ...rows.map((row) => sha256Hex(JSON.stringify(row))),
    ])
  )
  if (input.apply && input.previewDigest !== previewDigest) {
    throw new OrchestrationError(
      'conflict',
      'The directory changed since your preview. Preview the import again before applying it.'
    )
  }
  return previewDigest
}
