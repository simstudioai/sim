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
  InterfaceGrid,
  InterfaceLayout,
  InterfaceModule,
  InterfaceModuleType,
  InterfacePlacement,
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
  /**
   * Ceiling on the declared grid dimensions. This bounds the cost of the
   * O(cells) work the canvas and the collapse pass do; it is NOT the shipped
   * grid size, which is {@link DEFAULT_INTERFACE_GRID}.
   */
  MAX_GRID_ROWS: 12,
  MAX_GRID_COLS: 12,
  /**
   * Absolute cap on modules, independent of grid size — it bounds request
   * payload and validation cost, not geometry. How many modules actually fit
   * is decided by the grid: placements must fit within `layout.grid` and may
   * not overlap, so a 2x2 interface still tops out at four 1x1 modules
   * without this constant having to know that.
   */
  MAX_MODULES: 24,
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

/**
 * The grid a brand-new interface is minted with, and the only place the
 * shipped page shape is stated. Changing it changes what new interfaces get;
 * interfaces already stored keep the grid they were authored against, because
 * the grid travels inside the layout.
 */
export const DEFAULT_INTERFACE_GRID: InterfaceGrid = { rows: 2, cols: 2 }

/**
 * The span every module is created with. Modules that cover several tracks are
 * fully supported by the schema, the validator, and both renderers — nothing
 * but the authoring UI mints them yet.
 */
export const DEFAULT_MODULE_SPAN = { rowSpan: 1, colSpan: 1 } as const

/**
 * Record-level caps, wired the same way as {@link INTERFACE_LAYOUT_LIMITS}:
 * the contract declares them on the wire and the service re-asserts them, so
 * neither layer re-types the number.
 */
export const MAX_INTERFACE_NAME_LENGTH = 100
export const MAX_INTERFACE_DESCRIPTION_LENGTH = 500

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
  placement: InterfacePlacement
): InterfaceModule {
  switch (type) {
    case 'chat':
      return { id, type: 'chat', placement, config: DEFAULT_MODULE_CONFIGS.chat() }
    case 'form':
      return { id, type: 'form', placement, config: DEFAULT_MODULE_CONFIGS.form() }
    case 'table':
      return { id, type: 'table', placement, config: DEFAULT_MODULE_CONFIGS.table() }
    case 'file':
      return { id, type: 'file', placement, config: DEFAULT_MODULE_CONFIGS.file() }
  }
}

/**
 * The layout a new interface starts from. Shared by the service (which writes
 * it on create) and by tests, so "empty" has exactly one definition.
 */
export function createEmptyLayout(grid: InterfaceGrid = DEFAULT_INTERFACE_GRID): InterfaceLayout {
  return { version: 1, grid: { ...grid }, modules: [] }
}
