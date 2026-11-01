import { createSerializer, parseAsString } from 'nuqs/server'

/** `search` matches name, email, title, department, or location; `department` narrows to one. */
export const peopleParsers = {
  search: parseAsString.withDefault(''),
  department: parseAsString.withDefault(''),
} as const

export const peopleUrlKeys = { history: 'replace', clearOnDefault: true } as const

/** Links into the People page, such as a profile's department narrowing the list to it. */
export const serializePeopleView = createSerializer(peopleParsers)
