import { z } from 'zod'
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
  email: ['email', 'workemail', 'emailaddress', 'primaryemail', 'businessemail', 'useremail'],
  title: ['title', 'jobtitle', 'position', 'businesstitle'],
  department: ['department', 'dept', 'departmentname'],
  location: ['location', 'officelocation', 'worklocation', 'office'],
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

/** Which header holds each field, or why the file can't be imported. */
export function matchPeopleColumns(
  headers: readonly string[]
): { ok: true; columns: PeopleColumns } | { ok: false; message: string } {
  const email = findColumn(headers, COLUMN_ALIASES.email)
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
    title: findColumn(headers, COLUMN_ALIASES.title),
    department: findColumn(headers, COLUMN_ALIASES.department),
    location,
    startDate: findColumn(headers, COLUMN_ALIASES.startDate),
    managerEmail: findColumn(headers, COLUMN_ALIASES.managerEmail),
  }
  const { email: _, ...profileColumns } = columns
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

function locationOf(row: Record<string, string>, location: LocationColumns): string {
  if (location.kind === 'single') return cell(row, location.header)
  return location.headers
    .map((header) => cell(row, header))
    .filter(Boolean)
    .join(', ')
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

/**
 * What importing `rows` would change, without changing anything. Each row updates the member
 * with its email: a column the file has sets that field, a blank cell clears it, and a column it
 * lacks leaves the field alone. Rows apply in file order, so the first valid row for an email wins and
 * a manager that would close a reporting loop is refused in favor of the rows before it.
 */
export function planPeopleImport({
  columns,
  rows,
  members,
}: {
  columns: PeopleColumns
  rows: readonly Record<string, string>[]
  members: readonly PeopleImportMember[]
}): PeopleImportPlan {
  const byEmail = new Map(members.map((member) => [member.email.toLowerCase(), member]))
  const managers = new Map(
    members.map((member) => [member.memberId, member.profile?.managerMemberId ?? null])
  )
  const acceptedRowByEmail = new Map<string, number>()
  const changes: PeopleImportChange[] = []
  const issues: PeopleImportIssue[] = []
  let unchanged = 0

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    if (Object.values(row).every((value) => !value?.trim())) return
    const email = cell(row, columns.email).toLowerCase()
    const skip = (message: string) =>
      issues.push({ row: rowNumber, email: email || null, severity: 'skipped', message })

    if (!emailSchema.safeParse(email).success) return skip('Enter a valid email address')
    const earlierRow = acceptedRowByEmail.get(email)
    if (earlierRow !== undefined) return skip(`Already listed in row ${earlierRow}`)
    const member = byEmail.get(email)
    if (!member) return skip('Not a member of this organization')

    const fields: Partial<MemberProfileFields> = {}
    const texts = {
      title: columns.title === undefined ? undefined : cell(row, columns.title),
      department: columns.department === undefined ? undefined : cell(row, columns.department),
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
    if (columns.managerEmail !== undefined) {
      const managerEmail = cell(row, columns.managerEmail).toLowerCase()
      const manager = managerEmail ? byEmail.get(managerEmail) : null
      if (manager?.memberId === member.memberId) return skip("A person can't be their own manager")
      if (!managerEmail) {
        fields.managerMemberId = null
      } else if (!manager) {
        warning = `Manager ${managerEmail} is not a member, so the manager was left as it was`
      } else if (reportsTo(manager.memberId, member.memberId, managers)) {
        warning = `Reporting to ${managerEmail} would make a reporting loop, so the manager was left as it was`
      } else {
        fields.managerMemberId = manager.memberId
      }
    }

    acceptedRowByEmail.set(email, rowNumber)
    if (warning) issues.push({ row: rowNumber, email, severity: 'warning', message: warning })
    const current = member.profile ?? EMPTY_PROFILE
    const profile = { ...current, ...fields }
    if (
      (Object.keys(profile) as ProfileField[]).every((field) => profile[field] === current[field])
    ) {
      unchanged++
      return
    }
    managers.set(member.memberId, profile.managerMemberId)
    changes.push({ memberId: member.memberId, profile })
  })

  return { changes, unchanged, issues }
}
