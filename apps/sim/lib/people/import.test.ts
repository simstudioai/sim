import { describe, expect, it } from 'vitest'
import { matchPeopleColumns, planPeopleImport } from '@/lib/people/import'
import type { MemberProfileFields } from '@/lib/people/validation'

/** A whole profile: these fields, and nothing else recorded. */
function profile(fields: Partial<MemberProfileFields>): MemberProfileFields {
  return {
    title: null,
    department: null,
    location: null,
    startDate: null,
    managerMemberId: null,
    ...fields,
  }
}

const ada = { memberId: 'm-ada', email: 'ada@example.com', profile: null, active: true }
const bo = { memberId: 'm-bo', email: 'bo@example.com', profile: null, active: true }
const cy = { memberId: 'm-cy', email: 'cy@example.com', profile: null, active: true }

function plan(
  headers: string[],
  rows: Record<string, string>[],
  members: Parameters<typeof planPeopleImport>[0]['members'] = [ada, bo, cy]
) {
  const columns = matchPeopleColumns(headers)
  if (!columns.ok) throw new Error(columns.message)
  return planPeopleImport({ columns: columns.columns, rows, members })
}

describe('matchPeopleColumns', () => {
  it('reads the columns of a typical HR export, whatever their spelling', () => {
    const result = matchPeopleColumns([
      'First Name',
      'Work Email',
      'Job Title',
      'Dept',
      'Office',
      'Hire Date',
      'Manager Email',
    ])
    expect(result).toEqual({
      ok: true,
      columns: {
        email: 'Work Email',
        title: 'Job Title',
        department: 'Dept',
        location: { kind: 'single', header: 'Office' },
        startDate: 'Hire Date',
        managerEmail: 'Manager Email',
      },
    })
  })

  it('prefers a manager email column over a manager name column', () => {
    const result = matchPeopleColumns(['email', 'manager', 'manager_email'])
    expect(result.ok && result.columns.managerEmail).toBe('manager_email')
  })

  it('combines city, state, and country when there is no location column', () => {
    const result = matchPeopleColumns(['email', 'city', 'state', 'country'])
    expect(result.ok && result.columns.location).toEqual({
      kind: 'parts',
      headers: ['city', 'state', 'country'],
    })
  })

  it('refuses a file without an email column, which is how people are matched', () => {
    expect(matchPeopleColumns(['name', 'title'])).toEqual({
      ok: false,
      message: 'Add an email column so each row can be matched to a member',
    })
  })

  it('refuses a file with only an email column, which would change nothing', () => {
    expect(matchPeopleColumns(['Email', 'Notes'])).toEqual({
      ok: false,
      message: 'Add at least one of title, department, location, start date, or manager email',
    })
  })
})

describe('planPeopleImport', () => {
  it('sets every column the file has and leaves the others as they were', () => {
    const existing = {
      ...ada,
      profile: {
        title: 'Engineer',
        department: 'Platform',
        location: 'Berlin',
        startDate: '2020-01-01',
        managerMemberId: null,
      },
    }
    const result = plan(
      ['email', 'title'],
      [{ email: 'ADA@example.com ', title: 'Staff Engineer' }],
      [existing, bo]
    )
    expect(result.changes).toEqual([
      { memberId: 'm-ada', profile: { ...existing.profile, title: 'Staff Engineer' } },
    ])
    expect(result.issues).toEqual([])
  })

  it('clears a field whose cell is blank', () => {
    const existing = {
      ...ada,
      profile: {
        title: 'Engineer',
        department: null,
        location: null,
        startDate: null,
        managerMemberId: 'm-bo',
      },
    }
    const result = plan(
      ['email', 'title', 'manager email'],
      [{ email: 'ada@example.com', title: '', 'manager email': '' }],
      [existing, bo]
    )
    expect(result.changes).toEqual([
      { memberId: 'm-ada', profile: profile({ title: null, managerMemberId: null }) },
    ])
  })

  it('counts a row that matches what is stored as unchanged, without writing it', () => {
    const existing = {
      ...ada,
      profile: {
        title: 'Engineer',
        department: null,
        location: null,
        startDate: null,
        managerMemberId: null,
      },
    }
    const result = plan(
      ['email', 'title'],
      [{ email: 'ada@example.com', title: 'Engineer' }],
      [existing]
    )
    expect(result.changes).toEqual([])
    expect(result.unchanged).toBe(1)
  })

  it('resolves a manager by email to their membership', () => {
    const result = plan(
      ['email', 'manager email'],
      [{ email: 'ada@example.com', 'manager email': 'Bo@Example.com' }]
    )
    expect(result.changes).toEqual([
      { memberId: 'm-ada', profile: profile({ managerMemberId: 'm-bo' }) },
    ])
  })

  it('skips rows for people who are not members, with the row number a spreadsheet shows', () => {
    const result = plan(
      ['email', 'title'],
      [
        { email: 'ada@example.com', title: 'A' },
        { email: 'stranger@example.com', title: 'B' },
      ]
    )
    expect(result.changes).toHaveLength(1)
    expect(result.issues).toEqual([
      {
        row: 3,
        email: 'stranger@example.com',
        severity: 'skipped',
        message: 'Not a member of this organization',
      },
    ])
  })

  it.each([
    [{ email: 'not-an-email', title: 'A' }, 'Enter a valid email address'],
    [{ email: '', title: 'A' }, 'Enter a valid email address'],
    [{ email: 'ada@example.com', title: 'x'.repeat(201) }, 'Title is longer than 200 characters'],
  ])('skips an invalid row %j', (row, message) => {
    const result = plan(['email', 'title'], [row])
    expect(result.changes).toEqual([])
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 2, severity: 'skipped', message }),
    ])
  })

  it('ignores a completely empty row, as spreadsheets leave at the end', () => {
    const result = plan(
      ['email', 'title'],
      [
        { email: 'ada@example.com', title: 'A' },
        { email: '', title: '' },
      ]
    )
    expect(result.issues).toEqual([])
  })

  it('applies the first row for an email and skips the later ones', () => {
    const result = plan(
      ['email', 'title'],
      [
        { email: 'ada@example.com', title: 'First' },
        { email: 'Ada@example.com', title: 'Second' },
      ]
    )
    expect(result.changes).toEqual([{ memberId: 'm-ada', profile: profile({ title: 'First' }) }])
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 3, severity: 'skipped', message: 'Already listed in row 2' }),
    ])
  })

  it.each([
    ['2021-03-04', '2021-03-04'],
    ['2021/3/4', '2021-03-04'],
    ['3/4/2021', '2021-03-04'],
    ['2021-03-04T09:00:00Z', '2021-03-04'],
    ['2021-03-04 09:00', '2021-03-04'],
  ])('reads the start date %s', (value, startDate) => {
    const result = plan(
      ['email', 'start date'],
      [{ email: 'ada@example.com', 'start date': value }]
    )
    expect(result.changes).toEqual([{ memberId: 'm-ada', profile: profile({ startDate }) }])
  })

  it.each(['2021-02-30', '13/45/2021', '04.03.2021', 'March 4', '1/2/21', '2021-03-04Tsoon'])(
    'skips the row with the unreadable start date %s instead of guessing',
    (value) => {
      const result = plan(
        ['email', 'start date'],
        [{ email: 'ada@example.com', 'start date': value }]
      )
      expect(result.changes).toEqual([])
      expect(result.issues).toEqual([
        expect.objectContaining({
          severity: 'skipped',
          message: 'Use a start date like 2024-01-31 or 1/31/2024',
        }),
      ])
    }
  )

  it('leaves the manager as it was when the manager is not a member, and says so', () => {
    const result = plan(
      ['email', 'title', 'manager email'],
      [{ email: 'ada@example.com', title: 'A', 'manager email': 'gone@example.com' }]
    )
    expect(result.changes).toEqual([{ memberId: 'm-ada', profile: profile({ title: 'A' }) }])
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Manager gone@example.com is not a member, so the manager was left as it was',
      }),
    ])
  })

  it('skips a row that names its own person as manager', () => {
    const result = plan(
      ['email', 'manager email'],
      [{ email: 'ada@example.com', 'manager email': 'ada@example.com' }]
    )
    expect(result.changes).toEqual([])
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'skipped',
        message: "A person can't be their own manager",
      }),
    ])
  })

  it('refuses reporting lines that would loop, within the file or through stored managers', () => {
    const bossOfAda = {
      ...cy,
      profile: {
        title: null,
        department: null,
        location: null,
        startDate: null,
        managerMemberId: 'm-ada',
      },
    }
    const result = plan(
      ['email', 'manager email'],
      [
        { email: 'ada@example.com', 'manager email': 'bo@example.com' },
        { email: 'bo@example.com', 'manager email': 'cy@example.com' },
      ],
      [ada, bo, bossOfAda]
    )
    expect(result.changes).toEqual([
      { memberId: 'm-ada', profile: profile({ managerMemberId: 'm-bo' }) },
    ])
    expect(result.issues).toEqual([
      expect.objectContaining({
        row: 3,
        severity: 'warning',
        message: expect.stringContaining('would make a reporting loop'),
      }),
    ])
  })

  it('lets a corrected row apply after an invalid row for the same person', () => {
    const result = plan(
      ['email', 'start date'],
      [
        { email: 'ada@example.com', 'start date': 'soon' },
        { email: 'ada@example.com', 'start date': '2021-03-04' },
      ]
    )
    expect(result.changes).toEqual([
      { memberId: 'm-ada', profile: profile({ startDate: '2021-03-04' }) },
    ])
    expect(result.issues).toEqual([expect.objectContaining({ row: 2, severity: 'skipped' })])
  })

  it('follows a suspended manager when checking for loops, but never matches them', () => {
    const suspended = {
      memberId: 'm-sus',
      email: 'sus@example.com',
      active: false,
      profile: profile({ managerMemberId: 'm-ada' }),
    }
    const reportsToSuspended = { ...bo, profile: profile({ managerMemberId: 'm-sus' }) }
    const result = plan(
      ['email', 'manager email'],
      [
        { email: 'ada@example.com', 'manager email': 'bo@example.com' },
        { email: 'cy@example.com', 'manager email': 'sus@example.com' },
        { email: 'sus@example.com', 'manager email': '' },
      ],
      [ada, reportsToSuspended, cy, suspended]
    )
    expect(result.changes).toEqual([])
    expect(result.issues.map((issue) => [issue.row, issue.severity])).toEqual([
      [2, 'warning'],
      [3, 'warning'],
      [4, 'skipped'],
    ])
  })

  it('refuses an address two members share once case and spaces are ignored', () => {
    const twin = { memberId: 'm-twin', email: ' ADA@example.com', profile: null, active: true }
    const result = plan(
      ['email', 'title', 'manager email'],
      [
        { email: 'ada@example.com', title: 'A', 'manager email': '' },
        { email: 'bo@example.com', title: 'B', 'manager email': 'Ada@Example.com' },
      ],
      [ada, twin, bo]
    )
    expect(result.changes).toEqual([{ memberId: 'm-bo', profile: profile({ title: 'B' }) }])
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 2, severity: 'skipped' }),
      expect.objectContaining({ row: 3, severity: 'warning' }),
    ])
  })

  it('combines location parts, leaving out the blank ones', () => {
    const result = plan(
      ['email', 'city', 'state', 'country'],
      [{ email: 'ada@example.com', city: 'Austin', state: '', country: 'United States' }]
    )
    expect(result.changes).toEqual([
      { memberId: 'm-ada', profile: profile({ location: 'Austin, United States' }) },
    ])
  })
})
