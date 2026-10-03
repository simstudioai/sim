import neo4j from 'neo4j-driver'

interface NumberLike {
  toNumber(): number
}

function isNumberLike(value: unknown): value is NumberLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  )
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

export function convertNeo4jValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (neo4j.isInt(value) || isNumberLike(value)) return value.toNumber()
  if (Array.isArray(value)) return value.map(convertNeo4jValue)
  if (typeof value !== 'object') return value

  const record = asRecord(value)
  if (Array.isArray(record.labels) && record.properties && 'identity' in record) {
    return {
      identity: isNumberLike(record.identity) ? record.identity.toNumber() : record.identity,
      labels: record.labels,
      properties: convertNeo4jValue(record.properties),
    }
  }
  if (
    typeof record.type === 'string' &&
    record.properties &&
    'identity' in record &&
    'start' in record &&
    'end' in record
  ) {
    return {
      identity: isNumberLike(record.identity) ? record.identity.toNumber() : record.identity,
      start: isNumberLike(record.start) ? record.start.toNumber() : record.start,
      end: isNumberLike(record.end) ? record.end.toNumber() : record.end,
      type: record.type,
      properties: convertNeo4jValue(record.properties),
    }
  }
  if ('start' in record && 'end' in record && Array.isArray(record.segments)) {
    return {
      start: convertNeo4jValue(record.start),
      end: convertNeo4jValue(record.end),
      segments: record.segments.map((segment) => {
        const fields = typeof segment === 'object' && segment !== null ? asRecord(segment) : {}
        return {
          start: convertNeo4jValue(fields.start),
          relationship: convertNeo4jValue(fields.relationship),
          end: convertNeo4jValue(fields.end),
        }
      }),
      length: record.length,
    }
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, convertNeo4jValue(entry)])
  )
}
