import type { ToolParameterItemSchema } from '@/tools/types'

const GREENHOUSE_APPLICATION_CUSTOM_FIELD_VALUE_INPUT = {
  anyOf: [
    {
      type: 'string',
    },
    {
      type: 'boolean',
    },
    {
      type: 'number',
      description: 'User ID',
    },
    {
      description: 'Option name (string) or option ID (number).',
      anyOf: [
        {
          type: 'number',
        },
        {
          type: 'string',
        },
      ],
    },
    {
      type: 'array',
      description: 'Array of option names (strings) or option IDs (numbers).',
      anyOf: [
        {
          items: {
            type: 'string',
          },
        },
        {
          items: {
            type: 'number',
          },
        },
      ],
    },
    {
      type: 'number',
    },
    {
      type: 'object',
      required: ['amount', 'currency_code'],
      additionalProperties: false,
      properties: {
        amount: {
          type: 'number',
        },
        currency_code: {
          type: 'string',
          maxLength: 3,
        },
      },
    },
    {
      type: 'null',
      description: "Pass null to clear the field's value.",
    },
  ],
} as const satisfies ToolParameterItemSchema

export const GREENHOUSE_APPLICATION_CUSTOM_FIELD_INPUT = {
  anyOf: [
    {
      type: 'object',
      properties: {
        name_key: {
          type: 'string',
          maxLength: 255,
          description:
            'Required if custom_field_id is not provided. Exactly one of name_key or custom_field_id must be specified.',
        },
        value: GREENHOUSE_APPLICATION_CUSTOM_FIELD_VALUE_INPUT,
      },
      required: ['name_key'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        custom_field_id: {
          type: 'integer',
          description:
            'Required if name_key is not provided. Exactly one of name_key or custom_field_id must be specified.',
        },
        value: GREENHOUSE_APPLICATION_CUSTOM_FIELD_VALUE_INPUT,
      },
      required: ['custom_field_id'],
      additionalProperties: false,
    },
  ],
} as const satisfies ToolParameterItemSchema

export const GREENHOUSE_PHONE_NUMBER_INPUT = {
  type: 'object',
  required: ['value', 'type'],
  properties: {
    value: {
      type: 'string',
    },
    type: {
      type: 'string',
      anyOf: [
        {
          type: 'string',
          const: 'home',
        },
        {
          type: 'string',
          const: 'work',
        },
        {
          type: 'string',
          const: 'mobile',
        },
        {
          type: 'string',
          const: 'skype',
        },
        {
          type: 'string',
          const: 'other',
        },
      ],
    },
  },
} as const satisfies ToolParameterItemSchema

export const GREENHOUSE_ADDRESS_INPUT = {
  type: 'object',
  required: ['value', 'type'],
  properties: {
    value: {
      type: 'string',
    },
    type: {
      type: 'string',
      anyOf: [
        {
          type: 'string',
          const: 'home',
        },
        {
          type: 'string',
          const: 'work',
        },
        {
          type: 'string',
          const: 'other',
        },
      ],
    },
  },
} as const satisfies ToolParameterItemSchema

export const GREENHOUSE_EMAIL_ADDRESS_INPUT = {
  type: 'object',
  required: ['value', 'type'],
  properties: {
    value: {
      type: 'string',
    },
    type: {
      type: 'string',
      anyOf: [
        {
          type: 'string',
          const: 'personal',
        },
        {
          type: 'string',
          const: 'work',
        },
        {
          type: 'string',
          const: 'other',
        },
      ],
    },
  },
} as const satisfies ToolParameterItemSchema

export const GREENHOUSE_WEBSITE_ADDRESS_INPUT = {
  type: 'object',
  required: ['value', 'type'],
  properties: {
    value: {
      type: 'string',
    },
    type: {
      type: 'string',
      anyOf: [
        {
          type: 'string',
          const: 'personal',
        },
        {
          type: 'string',
          const: 'company',
        },
        {
          type: 'string',
          const: 'portfolio',
        },
        {
          type: 'string',
          const: 'blog',
        },
        {
          type: 'string',
          const: 'other',
        },
      ],
    },
  },
} as const satisfies ToolParameterItemSchema

const GREENHOUSE_CUSTOM_FIELD_VALUE_INPUT = {
  anyOf: [
    {
      type: 'string',
    },
    {
      type: 'boolean',
    },
    {
      type: 'number',
      description: 'User ID',
    },
    {
      description: 'Option name (string) or option ID (number).',
      anyOf: [
        {
          type: 'number',
        },
        {
          type: 'string',
        },
      ],
    },
    {
      type: 'array',
      description: 'Array of option names (strings) or option IDs (numbers).',
      anyOf: [
        {
          items: {
            type: 'string',
          },
        },
        {
          items: {
            type: 'number',
          },
        },
      ],
    },
    {
      type: 'number',
    },
    {
      type: 'object',
      required: ['amount', 'currency_code'],
      additionalProperties: false,
      properties: {
        amount: {
          type: 'number',
        },
        currency_code: {
          type: 'string',
          maxLength: 3,
        },
      },
    },
    {
      type: 'object',
      required: ['min_amount', 'max_amount', 'currency_code'],
      additionalProperties: false,
      properties: {
        min_amount: {
          type: 'number',
        },
        max_amount: {
          type: 'number',
        },
        currency_code: {
          type: 'string',
          maxLength: 3,
        },
      },
    },
    {
      type: 'object',
      required: ['min_value', 'max_value'],
      additionalProperties: false,
      properties: {
        min_value: {
          type: 'number',
        },
        max_value: {
          type: 'number',
        },
      },
    },
    {
      type: 'null',
      description: "Pass null to clear the field's value.",
    },
  ],
} as const satisfies ToolParameterItemSchema

export const GREENHOUSE_CUSTOM_FIELD_INPUT = {
  anyOf: [
    {
      type: 'object',
      properties: {
        name_key: {
          type: 'string',
          maxLength: 255,
          description:
            'Required if custom_field_id is not provided. Exactly one of name_key or custom_field_id must be specified.',
        },
        value: GREENHOUSE_CUSTOM_FIELD_VALUE_INPUT,
      },
      required: ['name_key'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        custom_field_id: {
          type: 'integer',
          description:
            'Required if name_key is not provided. Exactly one of name_key or custom_field_id must be specified.',
        },
        value: GREENHOUSE_CUSTOM_FIELD_VALUE_INPUT,
      },
      required: ['custom_field_id'],
      additionalProperties: false,
    },
  ],
} as const satisfies ToolParameterItemSchema
