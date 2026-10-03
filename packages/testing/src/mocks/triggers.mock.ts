import { vi } from 'vitest'

interface MockTriggerSubBlock {
  id: string
  [key: string]: unknown
}

interface MockBuildTriggerSubBlocksOptions {
  triggerId: string
  triggerOptions: Array<{ label: string; id: string }>
  includeDropdown?: boolean
  setupInstructions: string
  extraFields?: MockTriggerSubBlock[]
  fieldsBeforeWebhookUrl?: MockTriggerSubBlock[]
  providerWebhookUrl?: unknown
  webhookPlaceholder?: string
}

/**
 * Controllable mock functions for `@/triggers` (the trigger registry). No real trigger is imported.
 *
 * Defaults describe an empty registry that still lets block modules load:
 * - `mockGetTrigger` returns a fresh `{ subBlocks: [] }` (block definitions spread
 *   `getTrigger(id).subBlocks` at import time, so it must not throw or return `undefined`).
 * - `mockGetAllTriggers` returns `[]`; `mockIsTriggerValid` returns `false`.
 * - `mockBuildTriggerSubBlocks` is a faithful port of the real pure builder.
 *
 * @example
 * ```ts
 * import { triggersMockFns } from '@sim/testing/mocks/triggers.mock'
 *
 * triggersMockFns.mockIsTriggerValid.mockReturnValue(true)
 * triggersMockFns.mockGetTrigger.mockReturnValue({ id: 'slack_webhook', provider: 'slack', subBlocks: [] })
 * ```
 */
export const triggersMockFns = {
  mockGetTrigger: vi.fn((_triggerId: string): unknown => ({ subBlocks: [] })),
  mockGetAllTriggers: vi.fn((): unknown[] => []),
  mockIsTriggerValid: vi.fn((_triggerId: string): boolean => false),
  mockBuildTriggerSubBlocks: vi.fn(
    (options: MockBuildTriggerSubBlocksOptions): MockTriggerSubBlock[] => {
      const {
        triggerId,
        triggerOptions,
        includeDropdown = false,
        setupInstructions,
        extraFields = [],
        fieldsBeforeWebhookUrl = [],
        providerWebhookUrl,
        webhookPlaceholder = 'Webhook URL will be generated',
      } = options

      const blocks: MockTriggerSubBlock[] = []

      if (includeDropdown) {
        blocks.push({
          id: 'selectedTriggerId',
          title: 'Trigger Type',
          canvasNoun: 'an event',
          type: 'dropdown',
          mode: 'trigger',
          options: triggerOptions,
          value: () => triggerId,
          required: true,
        })
      }

      blocks.push(...fieldsBeforeWebhookUrl)
      blocks.push({
        id: 'webhookUrlDisplay',
        title: 'Webhook URL',
        type: 'short-input',
        readOnly: true,
        showCopyButton: true,
        ...(providerWebhookUrl ? { providerWebhookUrl } : { useWebhookUrl: true }),
        placeholder: webhookPlaceholder,
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: triggerId },
      })
      blocks.push(...extraFields)
      blocks.push({
        id: 'triggerInstructions',
        title: 'Setup Instructions',
        hideFromPreview: true,
        type: 'text',
        defaultValue: setupInstructions,
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: triggerId },
      })

      return blocks
    }
  ),
}

/**
 * Static mock module for `@/triggers`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/triggers', () => triggersMock)
 * ```
 */
export const triggersMock = {
  getTrigger: triggersMockFns.mockGetTrigger,
  getAllTriggers: triggersMockFns.mockGetAllTriggers,
  isTriggerValid: triggersMockFns.mockIsTriggerValid,
  buildTriggerSubBlocks: triggersMockFns.mockBuildTriggerSubBlocks,
}
