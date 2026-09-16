import { SCIM_MAX_FILTER_TERMS } from '@/ee/scim/lib/protocol/constants'
import { invalidFilter } from '@/ee/scim/lib/protocol/errors'
import { normalizeAttributePath, normalizeScimBoolean } from '@/ee/scim/lib/protocol/normalize'

/**
 * The filter grammar this server accepts, which is the subset the provisioning
 * clients actually send.
 *
 * Okta filters `userName eq "x"` before every create and `displayName eq "x"`
 * before every group push. Microsoft Entra states plainly that it "only uses
 * the following operators: eq, and", and queries by `userName`, `externalId`,
 * or `emails[type eq "work"].value` depending on which attribute the tenant
 * chose for matching. OneLogin and JumpCloud send the same `userName eq` probe.
 *
 * Everything outside that is refused with `invalidFilter` rather than
 * approximated. A filter this server silently widened would hand a provider a
 * different set of users than it asked for, and it would reconcile against that
 * set — deleting or deactivating whatever it believes has disappeared.
 */

/** Attributes a User filter may name, mapped to the field the repository knows. */
export type ScimUserFilterField =
  | 'id'
  | 'userName'
  | 'externalId'
  | 'email'
  | 'workEmail'
  | 'primaryEmail'
  | 'active'

/** Attributes a Group filter may name. */
export type ScimGroupFilterField = 'id' | 'displayName' | 'externalId'

export interface ScimFilterTerm<Field extends string> {
  field: Field
  value: string
}

const USER_FILTER_FIELDS: Record<string, ScimUserFilterField> = {
  id: 'id',
  username: 'userName',
  externalid: 'externalId',
  'emails.value': 'email',
  'emails[type eq "work"].value': 'workEmail',
  'emails[primary eq true].value': 'primaryEmail',
  active: 'active',
}

const GROUP_FILTER_FIELDS: Record<string, ScimGroupFilterField> = {
  id: 'id',
  displayname: 'displayName',
  externalid: 'externalId',
}

/**
 * Splits on the `and` keyword at the top level of the expression.
 *
 * Quote- and bracket-aware, so an `and` inside a quoted value or inside a
 * `[type eq "work"]` value filter is not mistaken for a separator.
 */
function splitConjunction(expression: string): string[] {
  const terms: string[] = []
  let depth = 0
  let quoted = false
  let escaped = false
  let start = 0

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (quoted) {
      if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') {
      quoted = true
      continue
    }
    if (character === '[' || character === '(') {
      depth += 1
      continue
    }
    if (character === ']' || character === ')') {
      depth -= 1
      if (depth < 0) throw invalidFilter('Unbalanced brackets in filter expression')
      continue
    }
    if (depth > 0) continue

    const isBoundary = (position: number) =>
      position < 0 || position >= expression.length || /\s/.test(expression[position])
    if (
      (character === 'a' || character === 'A') &&
      expression.slice(index, index + 3).toLowerCase() === 'and' &&
      isBoundary(index - 1) &&
      isBoundary(index + 3)
    ) {
      terms.push(expression.slice(start, index))
      start = index + 3
      index += 2
    }
  }

  if (quoted || depth !== 0) throw invalidFilter('Unterminated quote or bracket in filter')
  terms.push(expression.slice(start))
  return terms
}

/**
 * Splits `attributePath operator "value"` at the operator.
 *
 * Scanned rather than matched with one expression, because an attribute path may
 * itself contain spaces and an operator: `emails[type eq "work"].value` is a
 * single attribute, and a regex that stopped at the first space would read its
 * inner `eq` as the comparison and the rest as a malformed value.
 */
function splitAtOperator(term: string): { attribute: string; operator: string; value: string } {
  let depth = 0
  let quoted = false
  let escaped = false

  for (let index = 0; index < term.length; index += 1) {
    const character = term[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quoted) {
      if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') {
      quoted = true
      continue
    }
    if (character === '[') depth += 1
    else if (character === ']') depth -= 1
    if (depth !== 0 || !/\s/.test(character)) continue

    const rest = term.slice(index).trimStart()
    const operatorEnd = rest.search(/\s/)
    if (operatorEnd === -1) break
    const operator = rest.slice(0, operatorEnd)
    if (!/^[a-zA-Z]{2}$/.test(operator)) continue

    return {
      attribute: term.slice(0, index).trim(),
      operator: operator.toLowerCase(),
      value: rest.slice(operatorEnd).trim(),
    }
  }

  throw invalidFilter(`Unsupported filter expression: ${term.trim()}`)
}

function parseTerm(term: string): { attribute: string; value: string } {
  const { attribute, operator, value: rawValue } = splitAtOperator(term.trim())

  if (operator !== 'eq') {
    throw invalidFilter(`The filter operator ${operator} is not supported; use eq`)
  }

  const raw = rawValue.trim()
  /** RFC 7644 writes boolean comparisons unquoted, and only `active` is boolean here. */
  if (
    normalizeAttributePath(attribute).toLowerCase() === 'active' &&
    (raw === 'true' || raw === 'false')
  ) {
    return { attribute, value: raw }
  }
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) {
    throw invalidFilter('Filter values must be quoted strings')
  }
  let value: string
  try {
    value = JSON.parse(raw) as string
  } catch {
    throw invalidFilter('Filter values must be quoted strings')
  }

  if (normalizeAttributePath(attribute).toLowerCase() === 'active') {
    const active = normalizeScimBoolean(value)
    if (typeof active !== 'boolean')
      throw invalidFilter('active must be compared with true or false')
    return { attribute, value: String(active) }
  }

  return { attribute, value }
}

function parseTerms<Field extends string>(
  filter: string,
  fields: Record<string, Field>,
  resourceName: string
): ScimFilterTerm<Field>[] {
  const parts = splitConjunction(filter)
  if (parts.length > SCIM_MAX_FILTER_TERMS) {
    throw invalidFilter(`A filter may join at most ${SCIM_MAX_FILTER_TERMS} expressions with and`)
  }

  return parts.map((part) => {
    const { attribute, value } = parseTerm(part)
    const normalized = normalizeAttributePath(attribute).toLowerCase()
    const field = fields[normalized]
    if (!field) {
      throw invalidFilter(`The filter attribute ${attribute} is not supported for ${resourceName}`)
    }
    return { field, value }
  })
}

export function parseUserFilter(filter: string): ScimFilterTerm<ScimUserFilterField>[] {
  return parseTerms(filter, USER_FILTER_FIELDS, 'User')
}

export function parseGroupFilter(filter: string): ScimFilterTerm<ScimGroupFilterField>[] {
  return parseTerms(filter, GROUP_FILTER_FIELDS, 'Group')
}
