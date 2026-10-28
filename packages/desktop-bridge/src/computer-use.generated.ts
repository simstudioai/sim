// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/computer-use.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

const BundleId = z
  .string()
  .min(1)
  .max(255)
  .describe(
    "Exact bundleId returned by list_apps or a known installed macOS app. get_app_state may launch it.",
  );
const SnapshotId = z
  .string()
  .min(1)
  .max(128)
  .describe("Latest unconsumed snapshotId from get_app_state for this app. Actions consume it.");
const ElementId = z.string().min(1).max(128).describe("Element reference from that snapshot.");
const WindowId = z.string().min(1).max(128).describe("Window reference from that snapshot.");
/** Input fields shared across actions keep one description: Anthropic flattens the union and anyOfs differing copies. */
const TargetWindowId = WindowId.optional().describe(
  "Window reference from an earlier snapshot of this app. If omitted, get_app_state and press_key use the app's focused window; coordinate actions use the window the snapshot selected.",
);
const IncludeScreenshot = z
  .boolean()
  .optional()
  .describe(
    "Set true to include a screenshot in the returned state. On actions it overrides observeAfter.includeScreenshot.",
  );
const Coordinate = z.number().nonnegative().max(100_000);
const ObserveAfter = {
  observeAfter: z
    .strictObject({ includeScreenshot: z.boolean().optional() })
    .optional()
    .describe(
      "Every mutation returns fresh app state by default. Set includeScreenshot to true to include an image; otherwise no screenshot is captured. Observation failure never retries the action.",
    ),
  includeScreenshot: IncludeScreenshot,
};
const InputSequenceStep = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("type_text"), text: z.string().max(32_000) }),
  z.strictObject({ action: z.literal("press_key"), key: z.string().min(1).max(128) }),
]);
const ElementTarget = { bundleId: BundleId, snapshotId: SnapshotId, elementId: ElementId };
const PointTarget = {
  bundleId: BundleId,
  snapshotId: SnapshotId,
  windowId: TargetWindowId,
  x: Coordinate,
  y: Coordinate,
};
const ClickOptions = {
  button: z.enum(["left", "right"]).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
};
const ScrollOffsets = {
  deltaX: z
    .number()
    .min(-10_000)
    .max(10_000)
    .optional()
    .describe(
      "Horizontal scroll distance in points; positive scrolls right, negative left. Omit for 0 when deltaY is set.",
    ),
  deltaY: z
    .number()
    .min(-10_000)
    .max(10_000)
    .optional()
    .describe(
      "Vertical scroll distance in points; positive scrolls down, negative up. Omit for 0 when deltaX is set.",
    ),
};

const hasScrollDistance = (input: { deltaX?: number | undefined; deltaY?: number | undefined }) =>
  input.deltaX !== undefined || input.deltaY !== undefined;

/** Strict branches require an observed, unambiguous target before native input. */
export const ComputerUseSchema = z.union([
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("list_apps") }),
  z.strictObject({ action: z.literal("activate_app"), bundleId: BundleId, ...ObserveAfter }),
  z.strictObject({
    action: z.literal("get_app_state"),
    bundleId: BundleId,
    windowId: TargetWindowId,
    includeScreenshot: IncludeScreenshot,
  }),
  z.strictObject({ action: z.literal("click"), ...ElementTarget, ...ObserveAfter, ...ClickOptions }),
  z.strictObject({ action: z.literal("click"), ...PointTarget, ...ObserveAfter, ...ClickOptions }),
  z.strictObject({
    action: z.literal("type_text"),
    ...ObserveAfter,
    ...ElementTarget,
    text: z.string().max(32_000).describe("Literal text to type into the observed editable element."),
  }),
  z.strictObject({
    action: z.literal("press_key"),
    ...ObserveAfter,
    bundleId: BundleId,
    snapshotId: SnapshotId,
    windowId: TargetWindowId,
    elementId: ElementId.optional(),
    key: z
      .string()
      .min(1)
      .max(128)
      .describe(
        "One key or chord, such as Enter, Tab, Escape, or Cmd+A. With elementId, focuses that element first.",
      ),
  }),
  z
    .strictObject({ action: z.literal("scroll"), ...ElementTarget, ...ObserveAfter, ...ScrollOffsets })
    .refine(hasScrollDistance, "Scroll needs deltaX or deltaY."),
  z
    .strictObject({ action: z.literal("scroll"), ...PointTarget, ...ObserveAfter, ...ScrollOffsets })
    .refine(hasScrollDistance, "Scroll needs deltaX or deltaY."),
  z.strictObject({
    action: z.literal("drag"),
    ...PointTarget,
    ...ObserveAfter,
    toX: Coordinate,
    toY: Coordinate,
  }),
  z.strictObject({
    action: z.literal("set_value"),
    ...ObserveAfter,
    ...ElementTarget,
    value: z.string().max(32_000).describe("Replacement value for an accessibility-writable element."),
  }),
  z.strictObject({
    action: z.literal("input_sequence"),
    ...ElementTarget,
    ...ObserveAfter,
    activateFirst: z
      .boolean()
      .optional()
      .describe(
        "Explicitly bring this app to the foreground before the batch. Defaults to false; leave omitted for background input. An inactive app alone does not require activation. Do not set true when the user requires background operation. Editor, window, and geometry checks still apply.",
      ),
    steps: z
      .array(InputSequenceStep)
      .min(1)
      .max(32)
      .refine(
        (steps) =>
          steps.reduce((total, step) => total + (step.action === "type_text" ? step.text.length : 0), 0) <=
          32_000,
        "Combined sequence text exceeds 32000 UTF-16 code units",
      )
      .describe(
        "Sequential input into this observed editor. Stops if editor/window focus changes. At most 32 steps and 32000 total text code units; never automatically retry a partial sequence.",
      ),
  }),
  z.strictObject({
    action: z.literal("perform_action"),
    ...ObserveAfter,
    ...ElementTarget,
    accessibilityAction: z.string().min(1).max(128).describe("Exact action advertised by this element."),
  }),
]);
export type ComputerUseInput = z.infer<typeof ComputerUseSchema>;

export const ComputerUseStatusSchema = z.strictObject({
  kind: z.literal("status"),
  platform: z.literal("darwin"),
  accessibility: z.boolean(),
  screenRecording: z.boolean(),
});

export const ComputerUseAppSchema = z.strictObject({
  bundleId: BundleId,
  name: z.string().max(1024),
  pid: z.number().int().positive().optional(),
  isActive: z.boolean(),
});

export const ComputerUseWindowSchema = z.strictObject({
  windowId: WindowId,
  title: z.string().max(4096),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

const ComputerUseNodeSchema = z.strictObject({
  elementId: ElementId,
  role: z.string().max(128),
  parentId: ElementId.optional(),
  label: z.string().max(8192).optional(),
  value: z.string().max(32_000).optional(),
  enabled: z.boolean().optional(),
  focused: z
    .boolean()
    .optional()
    .describe(
      "Accessibility focus within this app; does not imply the app is foreground or an item is selected.",
    ),
  editable: z.boolean().optional(),
  placeholder: z.string().max(1024).optional(),
  actions: z.array(z.string().max(128)).max(128),
  windowId: WindowId.optional(),
  x: z.number().optional().describe("Global screen coordinate in points, not window-local."),
  y: z.number().optional().describe("Global screen coordinate in points, not window-local."),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
});

export const ComputerUseScreenshotSchema = z.strictObject({
  base64: z.string().min(1).max(11_200_000),
  mimeType: z.literal("image/png"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const ComputerUseSnapshotSchema = z.strictObject({
  kind: z.literal("state"),
  bundleId: BundleId,
  isActive: z
    .boolean()
    .optional()
    .describe(
      "Whether this app was foreground when observed. Omitted means unknown; inactive apps may still support background controls.",
    ),
  snapshotId: SnapshotId,
  windowId: WindowId,
  windows: z.array(ComputerUseWindowSchema).max(100),
  nodes: z.array(ComputerUseNodeSchema).max(2000),
  truncated: z.boolean(),
  screenshot: ComputerUseScreenshotSchema.optional(),
  screenshotError: z.string().max(2000).optional(),
});
export type ComputerUseSnapshot = z.infer<typeof ComputerUseSnapshotSchema>;

export const ComputerUseResultSchema = z.discriminatedUnion("kind", [
  ComputerUseStatusSchema,
  z.strictObject({ kind: z.literal("apps"), apps: z.array(ComputerUseAppSchema).max(1000) }),
  ComputerUseSnapshotSchema,
  z
    .strictObject({
      kind: z.literal("action"),
      action: z.enum([
        "activate_app",
        "click",
        "type_text",
        "press_key",
        "scroll",
        "drag",
        "set_value",
        "perform_action",
        "input_sequence",
      ]),
      bundleId: BundleId,
      dispatched: z.literal(true),
      verified: z.boolean(),
      sequence: z
        .strictObject({
          completedSteps: z.number().int().min(0).max(32),
          totalSteps: z.number().int().min(1).max(32),
          error: z.string().min(1).max(2000).optional(),
        })
        .optional(),
      observation: ComputerUseSnapshotSchema.optional(),
      observationError: z.string().min(1).max(2000).optional(),
    })
    .superRefine((result, ctx) => {
      if (result.action === "input_sequence" && !result.sequence)
        ctx.addIssue({
          code: "custom",
          path: ["sequence"],
          message: "Input sequences require dispatch progress",
        });
      if (result.sequence && result.sequence.completedSteps > result.sequence.totalSteps)
        ctx.addIssue({
          code: "custom",
          path: ["sequence", "completedSteps"],
          message: "Completed steps cannot exceed total steps",
        });
    }),
]);
export type ComputerUseResult = z.infer<typeof ComputerUseResultSchema>;

export const ComputerUseNativeErrorSchema = z.strictObject({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2000),
  dispatchState: z.literal("not_started").optional(),
});
export type ComputerUseNativeError = z.infer<typeof ComputerUseNativeErrorSchema>;

export const ComputerUseNativeReplySchema = z.union([
  z.strictObject({ id: z.string().min(1).max(128), result: ComputerUseResultSchema }),
  z.strictObject({
    id: z.string().min(1).max(128),
    error: ComputerUseNativeErrorSchema,
  }),
]);
