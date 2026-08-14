import { isRecordLike } from '@sim/utils/object'

/**
 * Mock payload generation from a trigger's `outputs` definition.
 *
 * Deliberately dependency-free. `@/triggers` imports this module, so anything reachable
 * from here becomes reachable from the trigger barrel — and reaching `@/blocks` (directly,
 * or via `trigger-utils`) recreates the `triggers` <-> `blocks` initialization cycle that
 * `scripts/check-trigger-block-cycle.ts` guards against.
 */

/**
 * Generates mock data based on the output type definition
 */
function generateMockValue(type: string, _description?: string, fieldName?: string): unknown {
  const name = fieldName || 'value'

  switch (type) {
    case 'string':
      return `mock_${name}`

    case 'number':
      return 42

    case 'boolean':
      return true

    case 'array':
      return [
        {
          id: 'item_1',
          name: 'Sample Item',
          value: 'Sample Value',
        },
      ]

    case 'json':
    case 'object':
      return {
        id: 'sample_id',
        name: 'Sample Object',
        status: 'active',
      }

    default:
      return null
  }
}

/**
 * Recursively processes nested output structures, expanding JSON-Schema-style
 * objects/arrays that define `properties` or `items` instead of returning
 * a generic placeholder.
 */
function processOutputField(key: string, field: unknown, depth = 0, maxDepth = 10): unknown {
  if (depth > maxDepth) {
    return null
  }

  if (
    field &&
    typeof field === 'object' &&
    'type' in field &&
    typeof (field as Record<string, unknown>).type === 'string'
  ) {
    const typedField = field as {
      type: string
      description?: string
      properties?: Record<string, unknown>
      items?: unknown
    }

    if (
      (typedField.type === 'object' || typedField.type === 'json') &&
      typedField.properties &&
      typeof typedField.properties === 'object'
    ) {
      const nestedObject: Record<string, unknown> = {}
      for (const [nestedKey, nestedField] of Object.entries(typedField.properties)) {
        nestedObject[nestedKey] = processOutputField(nestedKey, nestedField, depth + 1, maxDepth)
      }
      return nestedObject
    }

    if (typedField.type === 'array' && typedField.items && typeof typedField.items === 'object') {
      const itemValue = processOutputField(`${key}_item`, typedField.items, depth + 1, maxDepth)
      return [itemValue]
    }

    return generateMockValue(typedField.type, typedField.description, key)
  }

  if (isRecordLike(field)) {
    const nestedObject: Record<string, unknown> = {}
    for (const [nestedKey, nestedField] of Object.entries(field)) {
      nestedObject[nestedKey] = processOutputField(nestedKey, nestedField, depth + 1, maxDepth)
    }
    return nestedObject
  }

  return null
}

/**
 * Generates a mock payload based on outputs definition
 */
export function generateMockPayloadFromOutputsDefinition(
  outputs: Record<string, unknown>
): Record<string, unknown> {
  const mockPayload: Record<string, unknown> = {}

  for (const [key, output] of Object.entries(outputs)) {
    if (key === 'visualization') {
      continue
    }
    mockPayload[key] = processOutputField(key, output)
  }

  return mockPayload
}
