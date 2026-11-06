import { normalizeEmail } from '@sim/utils/string'
import { z } from 'zod'
import { findCyclicPaths } from '@/lib/people/hierarchy'
import {
  type MemberProfileFields,
  PROFILE_TEXT_MAX_LENGTH,
  parseStartDate,
} from '@/lib/people/validation'

type ProfileField = keyof MemberProfileFields

/** Where a file keeps each person's location: one column, or parts to join. */
type LocationColumns = { kind: 'single'; header: string } | { kind: 'parts'; headers: string[] }

export interface PeopleColumns {
  email: string
  login?: string
  title?: string
  department?: string
  location?: LocationColumns
  startDate?: string
  managerEmail?: string
}

/**
 * Header spellings for each column, best first, compared without case, spaces, or punctuation.
 * The order settles a file with both `Manager` (often a name) and `Manager Email`.
 */
const COLUMN_ALIASES = {
  email: [
    'email',
    'workemail',
    'emailaddress',
    'primaryemail',
    'businessemail',
    'useremail',
    'mail',
  ],
  login: ['userprincipalname', 'login'],
  title: ['title', 'jobtitle', 'position', 'businesstitle'],
  department: ['department', 'dept', 'departmentname'],
  location: ['location', 'officelocation', 'worklocation', 'office', 'physicaldeliveryofficename'],
  startDate: ['startdate', 'hiredate', 'dateofhire', 'joindate', 'originalhiredate'],
  managerEmail: [
    'manageremail',
    'manageremailaddress',
    'supervisoremail',
    'reportstoemail',
    'manager',
    'reportsto',
    'supervisor',
  ],
} as const

/** Joined in this order into one location when the file has no location column. */
const LOCATION_PARTS = ['city', 'state', 'country'] as const

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findColumn(headers: readonly string[], aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const header = headers.find((candidate) => headerKey(candidate) === alias)
    if (header !== undefined) return header
  }
  return undefined
}

const RECOGNIZED_KEYS = new Set<string>([
  ...Object.values(COLUMN_ALIASES).flat(),
  ...LOCATION_PARTS,
])

/** Two headers that spell the same recognized column differently (`Email`, `e-mail`), if any. */
function repeatedColumn(headers: readonly string[]): [string, string] | null {
  const seen = new Map<string, string>()
  for (const header of headers) {
    const key = headerKey(header)
    if (!RECOGNIZED_KEYS.has(key)) continue
    const earlier = seen.get(key)
    if (earlier !== undefined) return [earlier, header]
    seen.set(key, header)
  }
  return null
}

/** Which header holds each field, or why the file can't be imported. */
export function matchPeopleColumns(
  headers: readonly string[]
): { ok: true; columns: PeopleColumns } | { ok: false; message: string } {
  const repeated = repeatedColumn(headers)
  if (repeated) {
    return {
      ok: false,
      message: `The ${repeated[0]} and ${repeated[1]} columns name the same field; keep one`,
    }
  }
  const login = findColumn(headers, COLUMN_ALIASES.login)
  const email = findColumn(headers, COLUMN_ALIASES.email) ?? login
  if (!email) {
    return { ok: false, message: 'Add an email column so each row can be matched to a member' }
  }
  const locationHeader = findColumn(headers, COLUMN_ALIASES.location)
  const locationParts = LOCATION_PARTS.flatMap((part) => findColumn(headers, [part]) ?? [])
  const location: LocationColumns | undefined = locationHeader
    ? { kind: 'single', header: locationHeader }
    : locationParts.length
      ? { kind: 'parts', headers: locationParts }
      : undefined
  const columns: PeopleColumns = {
    email,
    ...(login && login !== email ? { login } : {}),
    title: findColumn(headers, COLUMN_ALIASES.title),
    department: findColumn(headers, COLUMN_ALIASES.department),
    location,
    startDate: findColumn(headers, COLUMN_ALIASES.startDate),
    managerEmail: findColumn(headers, COLUMN_ALIASES.managerEmail),
  }
  const { email: _, login: _login, ...profileColumns } = columns
  if (!Object.values(profileColumns).some(Boolean)) {
    return {
      ok: false,
      message: 'Add at least one of title, department, location, start date, or manager email',
    }
  }
  return { ok: true, columns }
}

export interface PeopleImportMember {
  memberId: string
  email: string
  profile: MemberProfileFields | null
  directoryManaged?: boolean
}

interface PeopleImportIssue {
  /** The row as a spreadsheet numbers it: the header is row 1. */
  row: number
  email: string | null
  /** `skipped`: nothing in the row was applied. `warning`: the rest of the row was. */
  severity: 'skipped' | 'warning'
  message: string
}

interface PeopleImportChange {
  memberId: string
  /** The member's whole profile once the row applies. */
  profile: MemberProfileFields
}

export interface PeopleImportPlan {
  changes: PeopleImportChange[]
  unchanged: number
  issues: PeopleImportIssue[]
}

const EMPTY_PROFILE: MemberProfileFields = {
  title: null,
  department: null,
  location: null,
  startDate: null,
  managerMemberId: null,
}

const TEXT_FIELD_LABELS = {
  title: 'Title',
  department: 'Department',
  location: 'Location',
} as const

const emailSchema = z.email()

function cell(row: Record<string, string>, header: string | undefined): string {
  return header === undefined ? '' : (row[header] ?? '').trim()
}

function locationOf(row: Record<string, string>, location: LocationColumns): string | undefined {
  if (location.kind === 'single') return row[location.header]?.trim()
  return location.headers
    .map((header) => cell(row, header))
    .filter(Boolean)
    .join(', ')
}

function rowEmail(row: Record<string, string>, columns: PeopleColumns): string {
  return normalizeEmail(cell(row, columns.email) || cell(row, columns.login))
}

/** Member addresses and referenced manager addresses whose existing reporting chains the batch can affect. */
export function peopleImportEmails(
  columns: PeopleColumns,
  rows: readonly Record<string, string>[]
) {
  const emails = new Set<string>()
  const managerEmails = new Set<string>()
  for (const row of rows) {
    const email = rowEmail(row, columns)
    if (email) emails.add(email)
    const manager = normalizeEmail(cell(row, columns.managerEmail))
    if (email && manager) managerEmails.add(manager)
  }
  return { emails: [...emails], managerEmails: [...managerEmails] }
}

/** Whether `managerMemberId` already reports, directly or not, to `memberId`. */
function reportsTo(
  managerMemberId: string,
  memberId: string,
  managers: ReadonlyMap<string, string | null>
): boolean {
  const seen = new Set<string>()
  for (
    let current: string | null = managerMemberId;
    current;
    current = managers.get(current) ?? null
  ) {
    if (current === memberId) return true
    if (seen.has(current)) return false
    seen.add(current)
  }
  return false
}

const profilesEqual = (left: MemberProfileFields, right: MemberProfileFields) =>
  (Object.keys(left) as ProfileField[]).every((field) => left[field] === right[field])

/**
 * What importing `rows` would change, without changing anything. Each row updates the member
 * with its email: a column the file has sets that field, a blank cell clears it, and a column it
 * lacks leaves the field alone. Files apply in row order. Directory snapshots match only unique
 * addresses and validate proposed reporting lines together so a reorganization can move a whole team.
 */
export function planPeopleImport({
  columns,
  rows,
  members,
  managerLinks = [],
  directory = false,
}: {
  columns: PeopleColumns
  rows: readonly Record<string, string>[]
  members: readonly PeopleImportMember[]
  managerLinks?: readonly { memberId: string; managerMemberId: string | null }[]
  directory?: boolean
}): PeopleImportPlan {
  const byEmail = new Map<string, PeopleImportMember | 'ambiguous'>()
  for (const member of members) {
    const key = normalizeEmail(member.email)
    byEmail.set(key, byEmail.has(key) ? 'ambiguous' : member)
  }
  /** The one active member an address names; `undefined` when none or several do. */
  const memberWith = (email: string) => {
    const found = byEmail.get(email)
    return found === 'ambiguous' ? undefined : found
  }
  const managers = new Map(managerLinks.map((link) => [link.memberId, link.managerMemberId]))
  for (const member of members)
    managers.set(member.memberId, member.profile?.managerMemberId ?? null)
  const ambiguousEmails = new Set<string>()
  if (directory) {
    const seen = new Set<string>()
    for (const row of rows) {
      const email = rowEmail(row, columns)
      if (seen.has(email)) ambiguousEmails.add(email)
      seen.add(email)
    }
  }
  const proposedLinks = new Map<
    string,
    { row: number; email: string; previous: MemberProfileFields }
  >()
  const acceptedRowByEmail = new Map<string, number>()
  const changes: PeopleImportChange[] = []
  const issues: PeopleImportIssue[] = []
  let unchanged = 0

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    if (Object.values(row).every((value) => !value?.trim())) return
    const email = rowEmail(row, columns)
    const skip = (message: string) =>
      issues.push({ row: rowNumber, email: email || null, severity: 'skipped', message })

    if (!emailSchema.safeParse(email).success) return skip('Enter a valid email address')
    if (ambiguousEmails.has(email))
      return skip('Multiple directory accounts use this email, so this profile was skipped')
    const earlierRow = acceptedRowByEmail.get(email)
    if (earlierRow !== undefined) return skip(`Already listed in row ${earlierRow}`)
    if (byEmail.get(email) === 'ambiguous') {
      return skip('More than one member has this email, so the row was not applied')
    }
    const member = memberWith(email)
    if (!member) return skip('Not a member of this organization')
    if (member.directoryManaged)
      return skip('This profile is managed by your directory. Update it at the source.')

    const fields: Partial<MemberProfileFields> = {}
    const texts = {
      title: columns.title ? row[columns.title]?.trim() : undefined,
      department: columns.department ? row[columns.department]?.trim() : undefined,
      location: columns.location ? locationOf(row, columns.location) : undefined,
    }
    for (const field of ['title', 'department', 'location'] as const) {
      const text = texts[field]
      if (text === undefined) continue
      if (text.length > PROFILE_TEXT_MAX_LENGTH) {
        return skip(
          `${TEXT_FIELD_LABELS[field]} is longer than ${PROFILE_TEXT_MAX_LENGTH} characters`
        )
      }
      fields[field] = text || null
    }
    if (columns.startDate !== undefined) {
      const value = cell(row, columns.startDate)
      const startDate = value ? parseStartDate(value) : null
      if (value && !startDate) return skip('Use a start date like 2024-01-31 or 1/31/2024')
      fields.startDate = startDate
    }

    let warning: string | null = null
    if (columns.managerEmail !== undefined && row[columns.managerEmail] !== undefined) {
      const managerEmail = normalizeEmail(cell(row, columns.managerEmail))
      const manager = managerEmail ? memberWith(managerEmail) : null
      if (manager?.memberId === member.memberId) return skip("A person can't be their own manager")
      if (!managerEmail) {
        fields.managerMemberId = null
      } else if (ambiguousEmails.has(managerEmail)) {
        warning = `Multiple directory accounts use ${managerEmail}, so the manager was left as it was`
      } else if (!manager) {
        warning = `Manager ${managerEmail} is not a member, so the manager was left as it was`
      } else if (!directory && reportsTo(manager.memberId, member.memberId, managers)) {
        warning = `Reporting to ${managerEmail} would make a reporting loop, so the manager was left as it was`
      } else {
        fields.managerMemberId = manager.memberId
      }
    }

    acceptedRowByEmail.set(email, rowNumber)
    if (warning) issues.push({ row: rowNumber, email, severity: 'warning', message: warning })
    const current = member.profile ?? EMPTY_PROFILE
    const profile = { ...current, ...fields }
    if (profilesEqual(profile, current)) {
      unchanged++
      return
    }
    if (directory && profile.managerMemberId !== current.managerMemberId) {
      proposedLinks.set(member.memberId, { row: rowNumber, email, previous: current })
    }
    managers.set(member.memberId, profile.managerMemberId)
    changes.push({ memberId: member.memberId, profile })
  })

  if (!proposedLinks.size) return { changes, unchanged, issues }
  const cyclic = findCyclicPaths(managers)
  if (!cyclic.size) return { changes, unchanged, issues }
  const safeChanges = changes.filter(({ memberId, profile }) => {
    const proposal = proposedLinks.get(memberId)
    if (!proposal || !cyclic.has(memberId)) return true
    issues.push({
      row: proposal.row,
      email: proposal.email,
      severity: 'warning',
      message: 'This reporting path contains a loop, so the manager was left as it was',
    })
    profile.managerMemberId = proposal.previous.managerMemberId
    if (!profilesEqual(profile, proposal.previous)) return true
    unchanged++
    return false
  })
  issues.sort((left, right) => left.row - right.row)
  return { changes: safeChanges, unchanged, issues }
}
