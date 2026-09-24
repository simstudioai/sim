// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/computer-use.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from 'zod'

const BundleId = z
  .string()
  .min(1)
  .max(255)
  .describe(
    'Exact bundleId returned by list_apps or a known installed macOS app. get_app_state may launch it.'
  )
const SnapshotId = z
  .string()
  .min(1)
  .max(128)
  .describe('Latest unconsumed snapshotId from get_app_state for this app. Actions consume it.')
const ElementId = z.string().min(1).max(128).describe('Element reference from that snapshot.')
const WindowId = z.string().min(1).max(128).describe('Window reference from that snapshot.')
const Coordinate = z.number().nonnegative().max(100_000)
const ElementTarget = { bundleId: BundleId, snapshotId: SnapshotId, elementId: ElementId }
const WindowTarget = { bundleId: BundleId, snapshotId: SnapshotId, windowId: WindowId }
const PointTarget = { ...WindowTarget, x: Coordinate, y: Coordinate }
const ClickOptions = {
  button: z.enum(['left', 'right']).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
}
const ScrollOffsets = {
  deltaX: z
    .number()
    .min(-10_000)
    .max(10_000)
    .describe('Horizontal scroll distance in points; positive scrolls right, negative left.'),
  deltaY: z
    .number()
    .min(-10_000)
    .max(10_000)
    .describe('Vertical scroll distance in points; positive scrolls down, negative up.'),
}

/** Strict branches require an observed, unambiguous target before native input. */
export const ComputerUseSchema = z.union([
  z.strictObject({ action: z.literal('status') }),
  z.strictObject({ action: z.literal('list_apps') }),
  z.strictObject({ action: z.literal('activate_app'), bundleId: BundleId }),
  z.strictObject({
    action: z.literal('get_app_state'),
    bundleId: BundleId,
    windowId: WindowId.optional(),
    includeScreenshot: z
      .boolean()
      .optional()
      .describe('Set true to include an image of the selected window.'),
  }),
  z.strictObject({ action: z.literal('click'), ...ElementTarget, ...ClickOptions }),
  z.strictObject({ action: z.literal('click'), ...PointTarget, ...ClickOptions }),
  z.strictObject({
    action: z.literal('type_text'),
    ...ElementTarget,
    text: z
      .string()
      .max(32_000)
      .describe('Literal text to type into the observed editable element.'),
  }),
  z.strictObject({
    action: z.literal('press_key'),
    ...WindowTarget,
    key: z
      .string()
      .min(1)
      .max(128)
      .describe('One key or chord, such as Enter, Tab, Escape, or Cmd+A.'),
  }),
  z.strictObject({ action: z.literal('scroll'), ...ElementTarget, ...ScrollOffsets }),
  z.strictObject({ action: z.literal('scroll'), ...PointTarget, ...ScrollOffsets }),
  z.strictObject({ action: z.literal('drag'), ...PointTarget, toX: Coordinate, toY: Coordinate }),
  z.strictObject({
    action: z.literal('set_value'),
    ...ElementTarget,
    value: z
      .string()
      .max(32_000)
      .describe('Replacement value for an accessibility-writable element.'),
  }),
  z.strictObject({
    action: z.literal('perform_action'),
    ...ElementTarget,
    accessibilityAction: z
      .string()
      .min(1)
      .max(128)
      .describe('Exact action advertised by this element.'),
  }),
])
export type ComputerUseInput = z.infer<typeof ComputerUseSchema>

export const ComputerUseStatusSchema = z.strictObject({
  kind: z.literal('status'),
  platform: z.literal('darwin'),
  accessibility: z.boolean(),
  screenRecording: z.boolean(),
})
export type ComputerUseStatus = z.infer<typeof ComputerUseStatusSchema>

export const ComputerUseAppSchema = z.strictObject({
  bundleId: BundleId,
  name: z.string().max(1024),
  pid: z.number().int().positive().optional(),
  isActive: z.boolean(),
})
export type ComputerUseApp = z.infer<typeof ComputerUseAppSchema>

export const ComputerUseWindowSchema = z.strictObject({
  windowId: WindowId,
  title: z.string().max(4096),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})
export type ComputerUseWindow = z.infer<typeof ComputerUseWindowSchema>

const ComputerUseNodeSchema = z.strictObject({
  elementId: ElementId,
  role: z.string().max(128),
  parentId: ElementId.optional(),
  label: z.string().max(8192).optional(),
  value: z.string().max(32_000).optional(),
  enabled: z.boolean().optional(),
  actions: z.array(z.string().max(128)).max(128),
  windowId: WindowId.optional(),
  x: z.number().optional().describe('Global screen coordinate in points, not window-local.'),
  y: z.number().optional().describe('Global screen coordinate in points, not window-local.'),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
})

export const ComputerUseScreenshotSchema = z.strictObject({
  base64: z.string().min(1).max(11_200_000),
  mimeType: z.literal('image/png'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const ComputerUseSnapshotSchema = z.strictObject({
  kind: z.literal('state'),
  bundleId: BundleId,
  snapshotId: SnapshotId,
  windowId: WindowId,
  windows: z.array(ComputerUseWindowSchema).max(100),
  nodes: z.array(ComputerUseNodeSchema).max(2000),
  truncated: z.boolean(),
  screenshot: ComputerUseScreenshotSchema.optional(),
  screenshotError: z.string().max(2000).optional(),
})
export type ComputerUseSnapshot = z.infer<typeof ComputerUseSnapshotSchema>

export const ComputerUseResultSchema = z.discriminatedUnion('kind', [
  ComputerUseStatusSchema,
  z.strictObject({ kind: z.literal('apps'), apps: z.array(ComputerUseAppSchema).max(1000) }),
  ComputerUseSnapshotSchema,
  z.strictObject({
    kind: z.literal('action'),
    action: z.enum([
      'activate_app',
      'click',
      'type_text',
      'press_key',
      'scroll',
      'drag',
      'set_value',
      'perform_action',
    ]),
    bundleId: BundleId,
    dispatched: z.literal(true),
    verified: z.boolean(),
  }),
])
export type ComputerUseResult = z.infer<typeof ComputerUseResultSchema>

export const ComputerUseNativeReplySchema = z.union([
  z.strictObject({ id: z.string().min(1).max(128), result: ComputerUseResultSchema }),
  z.strictObject({
    id: z.string().min(1).max(128),
    error: z.strictObject({
      code: z.string().min(1).max(128),
      message: z.string().min(1).max(2000),
    }),
  }),
])
