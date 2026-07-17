import { z } from 'zod'

const COLOR_PATTERN = /^(#[0-9A-Fa-f]{3,8}|var\(--[a-zA-Z0-9-]+\))$/

const selectOptionSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(200),
})

const baseControlFields = {
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  required: z.boolean().optional(),
  bind: z.string().min(1).max(128),
}

export const interfaceControlSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    ...baseControlFields,
    placeholder: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('textarea'),
    ...baseControlFields,
    placeholder: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('number'),
    ...baseControlFields,
  }),
  z.object({
    type: z.literal('select'),
    ...baseControlFields,
    options: z.array(selectOptionSchema).min(1).max(50),
  }),
  z.object({
    type: z.literal('checkbox'),
    ...baseControlFields,
  }),
  z.object({
    type: z.literal('markdown'),
    id: z.string().min(1).max(64),
    content: z.string().min(1).max(4000),
  }),
])

export const interfaceActionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  variant: z.enum(['primary', 'secondary']).default('primary'),
  submit: z.object({
    fieldMapping: z.record(z.string(), z.string()).default({}),
  }),
})

export const interfaceSpecSchema = z.object({
  version: z.literal(1),
  theme: z
    .object({
      primaryColor: z.string().regex(COLOR_PATTERN).optional(),
      density: z.enum(['comfortable', 'compact']).optional(),
    })
    .default({}),
  page: z
    .object({
      title: z.string().max(200).optional(),
      description: z.string().max(1000).optional(),
    })
    .default({}),
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().max(200).optional(),
        controls: z.array(interfaceControlSchema).max(40),
      })
    )
    .max(20)
    .default([]),
  actions: z.array(interfaceActionSchema).length(1),
  messages: z
    .object({
      success: z.string().max(500).optional(),
      error: z.string().max(500).optional(),
    })
    .optional(),
})

export type InterfaceControl = z.infer<typeof interfaceControlSchema>
export type InterfaceAction = z.infer<typeof interfaceActionSchema>
export type InterfaceSpec = z.infer<typeof interfaceSpecSchema>

export const INTERFACE_RESERVED_IDENTIFIERS = new Set([
  'generate',
  'manage',
  'validate',
  'auth',
  'status',
])

export const INTERFACE_IDENTIFIER_PATTERN = /^[a-z0-9-]+$/

export function isReservedInterfaceIdentifier(identifier: string): boolean {
  return INTERFACE_RESERVED_IDENTIFIERS.has(identifier)
}
