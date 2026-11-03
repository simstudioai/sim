import type { Person } from '@/lib/api/contracts/people'
import type { PersonRecord } from '@/lib/people/repository'

export function presentPerson(person: PersonRecord): Person {
  return { ...person, joinedAt: person.joinedAt.toISOString() }
}
