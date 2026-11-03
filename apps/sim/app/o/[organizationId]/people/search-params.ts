import { truncateAtCodePoint } from '@sim/utils/string'
import {
  createParser,
  createSerializer,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs/server'
import { PEOPLE_SEARCH_MAX_LENGTH } from '@/lib/people/validation'

const boundedSearch = (value: string) => truncateAtCodePoint(value, PEOPLE_SEARCH_MAX_LENGTH, '')

/** `search` matches name, email, title, department, or location; `department` narrows to one. */
export const peopleParsers = {
  view: parseAsStringLiteral(['chart', 'directory'] as const),
  panel: parseAsStringLiteral(['sync'] as const),
  focus: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  search: createParser({ parse: boundedSearch, serialize: boundedSearch }).withDefault(''),
  department: parseAsString.withDefault(''),
  departmentKey: parseAsString.withDefault(''),
} as const

export const peopleUrlKeys = { history: 'replace', clearOnDefault: true } as const

/** Links into the People page, such as a profile's department narrowing the list to it. */
export const serializePeopleView = createSerializer(peopleParsers)
