/**
 * Pure interface-domain constants and construction defaults.
 *
 * Split out of `validation.ts` / `service.ts` so the builder UI can enforce the
 * exact rules the server does. Both of those modules import `@sim/db` at module
 * scope, so a `'use client'` component that imported them — directly or through
 * the `@/lib/interfaces` barrel — would drag the postgres driver into the
 * browser bundle. This module's only import is `@/executor/types`, which is
 * type-only at runtime, so it is safe on both sides of the boundary.
 *
 * Server code reaches these through the `@/lib/interfaces` barrel; client code
 * imports `@/lib/interfaces/constants` directly.
 */

import type {
  ChatModuleConfig,
  FileModuleConfig,
  FormModuleConfig,
  InterfaceCell,
  InterfaceModule,
  InterfaceModuleType,
  TableModuleConfig,
} from '@/lib/interfaces/types'
import { EXECUTION_CONTROL_OUTPUT_FIELD_NAMES, START_BLOCK_METADATA_FIELD } from '@/executor/types'

/**
 * Structural bounds for a stored layout — the single home for every cap in the
 * interfaces domain.
 *
 * Every entry is enforced by `validateLayout`, declared by the boundary
 * contract (`@/lib/api/contracts/interfaces`), and read by the builder UI as
 * the `maxLength` it applies. All three consume these constants rather than
 * re-typing the numbers, so a bound can never drift between the layer that
 * accepts a value and the layer that later refuses it.
 */
export const INTERFACE_LAYOUT_LIMITS = {
  MAX_MODULES: 4,
  /** Applies to both module ids and form field ids. */
  MAX_ID_LENGTH: 128,
  MAX_FORM_FIELDS: 30,
  MAX_FIELD_NAME_LENGTH: 100,
  MAX_FIELD_LABEL_LENGTH: 100,
  MAX_OPTIONS: 50,
  MAX_OPTION_LENGTH: 100,
  MAX_PLACEHOLDER_LENGTH: 200,
  MAX_HINT_LENGTH: 200,
  MAX_WELCOME_MESSAGE_LENGTH: 500,
  MAX_OUTPUT_CONFIGS: 50,
  MAX_OUTPUT_PATH_LENGTH: 200,
  MAX_SUBMIT_LABEL_LENGTH: 100,
  MAX_DEFAULT_VALUE_LENGTH: 10_000,
  /** Cap on a single value submitted through a rendered form. */
  MAX_FORM_VALUE_LENGTH: 10_000,
} as const

/** Form field names become workflow start-block input keys. */
export const FORM_FIELD_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Field names that can never be used as form field names: the executor's
 * execution-control output fields plus the start-block keys the platform
 * itself writes (`metadata`, `input`, `conversationId`, `files`).
 */
export const RESERVED_FORM_FIELD_NAMES: readonly string[] = [
  ...EXECUTION_CONTROL_OUTPUT_FIELD_NAMES,
  START_BLOCK_METADATA_FIELD,
  'input',
  'conversationId',
  'files',
]

const RESERVED_FORM_FIELD_NAME_SET = new Set<string>(RESERVED_FORM_FIELD_NAMES)

/**
 * Whether `name` collides with a platform-owned start-block key. Matching is
 * case-sensitive: the start block keys its inputs by exact name, so `Input` is
 * a distinct — and legal — field name.
 */
export function isReservedFormFieldName(name: string): boolean {
  return RESERVED_FORM_FIELD_NAME_SET.has(name)
}

/**
 * Per-type empty config factories. Each returns a fresh object so callers can
 * mutate their copy without touching the next module's defaults.
 */
export const DEFAULT_MODULE_CONFIGS = {
  chat: (): ChatModuleConfig => ({
    workflowId: null,
    outputConfigs: [],
    showThinking: false,
    welcomeMessage: '',
  }),
  table: (): TableModuleConfig => ({ tableId: null }),
  file: (): FileModuleConfig => ({ fileId: null }),
  form: (): FormModuleConfig => ({ workflowId: null, fields: [], submitLabel: 'Submit' }),
} as const

/**
 * Builds a fully-defaulted module. The canvas mints `id` client-side so the
 * new module can be selected before the layout write lands; the service mints
 * it server-side. Both paths produce byte-identical config, so an optimistic
 * layout never disagrees with what the server persists.
 */
export function createInterfaceModule(
  id: string,
  type: InterfaceModuleType,
  cell: InterfaceCell
): InterfaceModule {
  switch (type) {
    case 'chat':
      return { id, type: 'chat', cell, config: DEFAULT_MODULE_CONFIGS.chat() }
    case 'form':
      return { id, type: 'form', cell, config: DEFAULT_MODULE_CONFIGS.form() }
    case 'table':
      return { id, type: 'table', cell, config: DEFAULT_MODULE_CONFIGS.table() }
    case 'file':
      return { id, type: 'file', cell, config: DEFAULT_MODULE_CONFIGS.file() }
  }
}
