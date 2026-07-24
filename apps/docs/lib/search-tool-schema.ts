import { jsonSchema } from 'ai'

interface SearchDocsInput {
  query: string
}

export function validateSearchDocsInput(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('query' in value) ||
    typeof value.query !== 'string'
  ) {
    return {
      success: false as const,
      error: new TypeError('Search documentation input must contain only a string query'),
    }
  }

  return {
    success: true as const,
    value: { query: value.query },
  }
}

export const searchDocsInputSchema = jsonSchema<SearchDocsInput>(
  {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A focused natural-language search query.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  { validate: validateSearchDocsInput }
)
