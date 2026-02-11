import type { OutputType } from '@/tools/types'

/** Transforms a raw FullItem API response into our standardized output. */
export function transformFullItem(data: any) {
  return {
    id: data.id ?? null,
    title: data.title ?? null,
    vault: data.vault ?? null,
    category: data.category ?? null,
    urls: (data.urls ?? []).map((url: any) => ({
      href: url.href ?? null,
      label: url.label ?? null,
      primary: url.primary ?? false,
    })),
    favorite: data.favorite ?? false,
    tags: data.tags ?? [],
    version: data.version ?? 0,
    state: data.state ?? null,
    fields: (data.fields ?? []).map((field: any) => ({
      id: field.id ?? null,
      label: field.label ?? null,
      type: field.type ?? 'STRING',
      purpose: field.purpose ?? '',
      value: field.value ?? null,
      section: field.section ?? null,
      generate: field.generate ?? false,
      recipe: field.recipe
        ? {
            length: field.recipe.length ?? null,
            characterSets: field.recipe.characterSets ?? [],
            excludeCharacters: field.recipe.excludeCharacters ?? null,
          }
        : null,
      entropy: field.entropy ?? null,
    })),
    sections: (data.sections ?? []).map((section: any) => ({
      id: section.id ?? null,
      label: section.label ?? null,
    })),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    lastEditedBy: data.lastEditedBy ?? null,
  }
}

/** Shared output schema for FullItem responses (get_item, create_item, update_item). */
export const FULL_ITEM_OUTPUTS: Record<
  string,
  {
    type: OutputType
    description: string
    optional?: boolean
    properties?: Record<string, any>
    items?: { type: OutputType; description?: string; properties?: Record<string, any> }
  }
> = {
  id: { type: 'string', description: 'Item ID' },
  title: { type: 'string', description: 'Item title' },
  vault: {
    type: 'object',
    description: 'Vault reference',
    properties: {
      id: { type: 'string', description: 'Vault ID' },
    },
  },
  category: {
    type: 'string',
    description: 'Item category (e.g., LOGIN, API_CREDENTIAL, SECURE_NOTE)',
  },
  urls: {
    type: 'array',
    description: 'URLs associated with the item',
    optional: true,
    items: {
      type: 'object',
      properties: {
        href: { type: 'string', description: 'URL' },
        label: { type: 'string', description: 'URL label', optional: true },
        primary: { type: 'boolean', description: 'Whether this is the primary URL' },
      },
    },
  },
  favorite: { type: 'boolean', description: 'Whether the item is favorited' },
  tags: { type: 'array', description: 'Item tags' },
  version: { type: 'number', description: 'Item version number' },
  state: { type: 'string', description: 'Item state (ARCHIVED or DELETED)', optional: true },
  fields: {
    type: 'array',
    description: 'Item fields including secrets',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Field ID' },
        label: { type: 'string', description: 'Field label', optional: true },
        type: {
          type: 'string',
          description: 'Field type (STRING, EMAIL, CONCEALED, URL, TOTP, DATE, MONTH_YEAR, MENU)',
        },
        purpose: {
          type: 'string',
          description: 'Field purpose (USERNAME, PASSWORD, NOTES, or empty)',
        },
        value: { type: 'string', description: 'Field value', optional: true },
        section: {
          type: 'object',
          description: 'Section reference this field belongs to',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Section ID' },
          },
        },
        generate: { type: 'boolean', description: 'Whether the field value should be generated' },
        recipe: {
          type: 'object',
          description: 'Password generation recipe',
          optional: true,
          properties: {
            length: { type: 'number', description: 'Generated password length', optional: true },
            characterSets: {
              type: 'array',
              description: 'Character sets (LETTERS, DIGITS, SYMBOLS)',
            },
            excludeCharacters: {
              type: 'string',
              description: 'Characters to exclude',
              optional: true,
            },
          },
        },
        entropy: { type: 'number', description: 'Password entropy score', optional: true },
      },
    },
  },
  sections: {
    type: 'array',
    description: 'Item sections',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Section ID' },
        label: { type: 'string', description: 'Section label', optional: true },
      },
    },
  },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
  lastEditedBy: { type: 'string', description: 'ID of the last editor', optional: true },
}
