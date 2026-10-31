import { isRecordLike } from '@sim/utils/object'
import catalog from '@/tools/companyenrich/operations.json'

interface Schema {
  type?: string
  format?: string
  nullable?: boolean
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, Schema>
  items?: Schema
}
interface Operation {
  method: string
  path: string
  title: string
  beta: boolean
  parameters: { name: string; in: string; required: boolean; schema: Schema }[]
  body: Schema
}
const OPERATIONS: Record<string, Operation> = catalog
interface OperationInput {
  operation: string
  body?: unknown
  query?: unknown
  path_parameters?: unknown
  allow_beta?: boolean
}
function inputObject(value: unknown, name = 'input'): Record<string, unknown> {
  if (value === undefined) return {}
  if (!isRecordLike(value)) throw new Error(`${name} must be an object`)
  return value
}
export function mergeDefined(base: unknown, dedicated: Record<string, unknown>) {
  const result = { ...inputObject(base, 'filters') }
  for (const [key, value] of Object.entries(dedicated)) {
    if (value !== undefined) result[key] = value
  }
  return result
}
function validJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || value === null || seen.has(value))
    throw new Error('Inputs must contain finite JSON values without cycles')
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error('Inputs must contain plain JSON objects')
  seen.add(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) validJson(child, seen)
  seen.delete(value)
}
function positiveInt64(value: unknown, label: string) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer or decimal string`)
  }
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (!/^[1-9]\d*$/.test(text) || BigInt(text) > 9223372036854775807n) {
    throw new Error(`${label} must be a positive int64; use a decimal string for large IDs`)
  }
}
function validate(value: unknown, schema: Schema, label: string): void {
  if (value === null && (schema.nullable || schema.enum?.includes(null))) return
  if (schema.format === 'int64') {
    positiveInt64(value, label)
    return
  }
  if (schema.enum && !schema.enum.includes(value))
    throw new Error(`${label} has an unsupported value`)
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') throw new Error(`${label} must be a string`)
      if (schema.minLength !== undefined && value.length < schema.minLength)
        throw new Error(`${label} is too short`)
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        throw new Error(`${label} is too long`)
      if (
        schema.format === 'uuid' &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      )
        throw new Error(`${label} must be a UUID`)
      break
    case 'integer':
    case 'number':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (schema.type === 'integer' && !Number.isSafeInteger(value))
      )
        throw new Error(`${label} must be a finite ${schema.type}`)
      if (schema.minimum !== undefined && value < schema.minimum)
        throw new Error(`${label} is below its minimum`)
      if (schema.maximum !== undefined && value > schema.maximum)
        throw new Error(`${label} exceeds its maximum`)
      break
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
      break
    case 'array':
      if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
      if (schema.minItems !== undefined && value.length < schema.minItems)
        throw new Error(`${label} has too few items`)
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        throw new Error(`${label} has too many items`)
      if (schema.items) for (const item of value) validate(item, schema.items, `${label} item`)
      break
    case 'object': {
      const object = inputObject(value, label)
      for (const key of schema.required ?? []) {
        if (object[key] === undefined || object[key] === null)
          throw new Error(`${label}.${key} is required`)
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (object[key] !== undefined) validate(object[key], child, `${label}.${key}`)
      }
      break
    }
  }
}
function nonempty(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a nonempty string`)
}
function pagination(value: Record<string, unknown>) {
  for (const key of ['page', 'pageSize']) {
    const v = value[key]
    if (
      v !== undefined &&
      (typeof v !== 'number' ||
        !Number.isSafeInteger(v) ||
        v < 1 ||
        (key === 'pageSize' && v > 100))
    )
      throw new Error(
        `${key} must be a positive integer${key === 'pageSize' ? ' no greater than 100' : ''}`
      )
  }
  const page = value.page ?? 1
  const size = value.pageSize ?? 10
  if (typeof page === 'number' && typeof size === 'number' && page * size > 10000)
    throw new Error('page × pageSize must not exceed 10,000')
}
function serialize(value: unknown, schema: Schema = {}): string {
  if (schema.format === 'int64' && typeof value === 'string') return value
  if (Array.isArray(value))
    return `[${value.map((item) => serialize(item, schema.items)).join(',')}]`
  if (isRecordLike(value))
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item, schema.properties?.[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function prepareOperation(input: OperationInput) {
  const operation = Object.hasOwn(OPERATIONS, input.operation)
    ? OPERATIONS[input.operation]
    : undefined
  if (!operation) throw new Error('Unknown CompanyEnrich operation')
  if (input.allow_beta !== undefined && typeof input.allow_beta !== 'boolean')
    throw new Error('allow_beta must be a boolean')
  if (operation.beta && input.allow_beta !== true)
    throw new Error('This email operation is beta; set allow_beta=true explicitly')
  const body = { ...inputObject(input.body, 'body') }
  const query = { ...inputObject(input.query, 'query') }
  const paths = inputObject(input.path_parameters, 'path_parameters')
  if (operation.body.properties?.pageSize && body.pageSize === undefined) body.pageSize = 10
  if (
    operation.body.properties?.page &&
    operation.body.properties?.pageSize &&
    body.page === undefined
  )
    body.page = 1
  if (operation.parameters.some((p) => p.in === 'query' && p.name === 'pageSize')) {
    if (query.page === undefined) query.page = 1
    if (query.pageSize === undefined) query.pageSize = 10
  }
  validJson(body)
  validJson(query)
  validJson(paths)
  let path = operation.path
  const search = new URLSearchParams()
  for (const [location, values] of [
    ['query', query],
    ['path', paths],
  ] as const) {
    const definitions = operation.parameters.filter((p) => p.in === location)
    for (const key of Object.keys(values)) {
      if (!definitions.some((p) => p.name === key))
        throw new Error(`Unknown ${location} parameter: ${key}`)
    }
    for (const definition of definitions) {
      const value = values[definition.name]
      if (value === undefined) {
        if (definition.required) throw new Error(`${definition.name} is required`)
        continue
      }
      validate(value, definition.schema, definition.name)
      if (
        definition.required ||
        ['domain', 'id', 'jobId', 'countryCode'].includes(definition.name)
      ) {
        if (definition.schema.type === 'string') nonempty(value, definition.name)
      }
      if (location === 'path' && (value === '.' || value === '..'))
        throw new Error('Path parameters cannot be dot segments')
      if (location === 'path')
        path = path.replace(`{${definition.name}}`, encodeURIComponent(String(value)))
      else if (value !== null)
        for (const item of Array.isArray(value) ? value : [value])
          search.append(definition.name, String(item))
    }
  }
  if (operation.method === 'GET' && Object.keys(body).length)
    throw new Error('GET operations do not accept a body')
  if (operation.method !== 'GET') validate(body, operation.body, 'body')
  if (
    input.operation === 'get_companies_workforce' &&
    Number(query.id !== undefined) + Number(query.domain !== undefined) !== 1
  )
    throw new Error('Provide exactly one workforce company id or domain')
  if (
    input.operation === 'post_companies_enrich' &&
    !Object.keys(operation.body.properties ?? {}).some(
      (key) => typeof body[key] === 'string' && String(body[key]).trim()
    )
  )
    throw new Error('Provide at least one company name or social property')
  if (operation.path.startsWith('/companies/similar') && !Array.isArray(body.domains)) {
    if (input.operation !== 'post_companies_similar') throw new Error('domains is required')
    nonempty(body.domain, 'domain or domains')
  }
  if (
    input.operation === 'post_companies_search_async' &&
    body.similar !== undefined &&
    body.similar !== null
  ) {
    const similar = inputObject(body.similar, 'similar')
    if (!Array.isArray(similar.domains)) throw new Error('similar.domains is required')
    for (const domain of similar.domains) nonempty(domain, 'similar domain')
  }
  if (Array.isArray(body.domains)) for (const domain of body.domains) nonempty(domain, 'domain')
  if (input.operation === 'post_people_lookup') {
    nonempty(body.email, 'email')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email)))
      throw new Error('Provide a valid email')
  }
  if (Array.isArray(body.items))
    for (const item of body.items) {
      const value = inputObject(item, 'item')
      if (value.domain !== undefined && value.domain !== null) nonempty(value.domain, 'domain')
    }
  pagination(body)
  pagination(query)
  if (
    body.count !== undefined &&
    (typeof body.count !== 'number' ||
      !Number.isSafeInteger(body.count) ||
      body.count < 1 ||
      body.count > 50000)
  )
    throw new Error('count must be an integer from 1 to 50,000')
  const suffix = search.toString()
  const serialized = operation.method === 'GET' ? undefined : serialize(body, operation.body)
  return {
    url: `https://api.companyenrich.com${path}${suffix ? `?${suffix}` : ''}`,
    method: operation.method as 'GET' | 'POST',
    body: serialized,
  }
}
