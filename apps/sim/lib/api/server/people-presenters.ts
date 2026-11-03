import { sha256Hex } from '@sim/security/hash'
import type { Person } from '@/lib/api/contracts/people'
import type { PersonRecord } from '@/lib/people/repository'

/** Short readable labels fit in a URL. Link to longer values by their complete UTF-8 digest. */
export function departmentFilterKey(department: string | null): string | undefined {
  return department && Buffer.byteLength(department) > 200 ? sha256Hex(department) : undefined
}

export function presentPerson(person: PersonRecord): Person {
  return {
    ...person,
    departmentKey: departmentFilterKey(person.department),
    joinedAt: person.joinedAt?.toISOString() ?? null,
  }
}
