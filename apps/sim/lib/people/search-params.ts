import { truncateAtCodePoint } from '@sim/utils/string'
import { createParser, createSerializer, parseAsInteger, parseAsStringLiteral } from 'nuqs/server'
import {
  DIRECTORY_TEXT_MAX_LENGTH,
  PEOPLE_DEPARTMENT_KEY_PATTERN,
  PEOPLE_ID_MAX_LENGTH,
  PEOPLE_SEARCH_MAX_LENGTH,
} from '@/lib/people/validation'

const boundedSearch = (value: string) => truncateAtCodePoint(value, PEOPLE_SEARCH_MAX_LENGTH, '')

/** `search` matches name, email, title, department, or location; `department` narrows to one. */
export const peopleParsers = {
  view: parseAsStringLiteral(['chart', 'directory'] as const),
  panel: parseAsStringLiteral(['sync'] as const),
  focus: createParser({
    parse: (value) => (value.length > 0 && value.length <= PEOPLE_ID_MAX_LENGTH ? value : null),
    serialize: (value) => value,
  }).withDefault(''),
  page: parseAsInteger.withDefault(1),
  search: createParser({ parse: boundedSearch, serialize: boundedSearch }).withDefault(''),
  department: createParser({
    parse: (value) => (value.length <= DIRECTORY_TEXT_MAX_LENGTH ? value : null),
    serialize: (value) => value,
  }).withDefault(''),
  departmentKey: createParser({
    parse: (value) => (PEOPLE_DEPARTMENT_KEY_PATTERN.test(value) ? value : null),
    serialize: (value) => value,
  }).withDefault(''),
} as const

export const peopleUrlKeys = { history: 'replace', clearOnDefault: true } as const

/** Links into the People page, such as a profile's department narrowing the list to it. */
export const serializePeopleView = createSerializer(peopleParsers)
