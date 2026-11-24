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
const TypedText = z.string().max(32_000).describe("Literal text to type into the observed editable element.");
const ReplacementValue = z
  .string()
  .max(32_000)
  .describe("Replacement value for an accessibility-writable element.");
const KeyChord = z
  .string()
  .min(1)
  .max(128)
  .describe(
    "One key or chord, such as Enter, Tab, Escape, or Cmd+A. With elementId, focuses that element first.",
  );
const AccessibilityAction = z.string().min(1).max(128).describe("Exact action advertised by this element.");

/** The text a batch step sends, counted against the batch's 32000 UTF-16 code units. */
function batchStepTextLength(step: { action: string; text?: string; value?: string }): number {
  if (step.action === "type_text") return step.text?.length ?? 0;
  if (step.action === "set_value") return step.value?.length ?? 0;
  return 0;
}

/** A batch step is the matching single action without its app, snapshot and observation fields, which the batch carries. */
const BatchStep = z.union([
  z.strictObject({ action: z.literal("click"), elementId: ElementId, ...ClickOptions }),
  z.strictObject({
    action: z.literal("click"),
    windowId: TargetWindowId,
    x: Coordinate,
    y: Coordinate,
    ...ClickOptions,
  }),
  z.strictObject({ action: z.literal("type_text"), elementId: ElementId, text: TypedText }),
  z.strictObject({ action: z.literal("set_value"), elementId: ElementId, value: ReplacementValue }),
  z.strictObject({
    action: z.literal("press_key"),
    windowId: TargetWindowId,
    elementId: ElementId.optional(),
    key: KeyChord,
  }),
  z
    .strictObject({ action: z.literal("scroll"), elementId: ElementId, ...ScrollOffsets })
    .refine(hasScrollDistance, "Scroll needs deltaX or deltaY."),
  z
    .strictObject({
      action: z.literal("scroll"),
      windowId: TargetWindowId,
      x: Coordinate,
      y: Coordinate,
      ...ScrollOffsets,
    })
    .refine(hasScrollDistance, "Scroll needs deltaX or deltaY."),
  z.strictObject({
    action: z.literal("perform_action"),
    elementId: ElementId,
    accessibilityAction: AccessibilityAction,
  }),
]);

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
    text: TypedText,
  }),
  z.strictObject({
    action: z.literal("press_key"),
    ...ObserveAfter,
    bundleId: BundleId,
    snapshotId: SnapshotId,
    windowId: TargetWindowId,
    elementId: ElementId.optional(),
    key: KeyChord,
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
    value: ReplacementValue,
  }),
  z.strictObject({
    action: z.literal("input_sequence"),
    ...ElementTarget,
    ...ObserveAfter,
    activateFirst: z
      .boolean()
      .optional()
      .describe(
        "Explicitly bring this app to the foreground before the sequence. Defaults to false; leave omitted for background input. An inactive app alone does not require activation. Do not set true when the user requires background operation. Editor, window, and geometry checks still apply.",
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
    accessibilityAction: AccessibilityAction,
  }),
  z.strictObject({
    action: z.literal("batch"),
    bundleId: BundleId,
    snapshotId: SnapshotId,
    ...ObserveAfter,
    steps: z
      .array(BatchStep)
      .min(2)
      .max(8)
      .refine(
        (steps) => steps.reduce((total, step) => total + batchStepTextLength(step), 0) <= 32_000,
        "Combined batch text exceeds 32000 UTF-16 code units",
      )
      .describe(
        "2–8 actions on this app planned from the same snapshot, run in order with that snapshot's references. The batch stops at the first step that fails and after any step that opens or closes a window, sheet, menu or popover; later steps do not run. Read sequence.completedSteps before continuing, and never automatically retry a partial batch.",
      ),
  }),
]);
export type ComputerUseInput = z.infer<typeof ComputerUseSchema>;

/** Typed app commands: one allowlisted create or list read through the OS's own data frameworks, never a script. */
const CommandTitle = z
  .string()
  .max(1024)
  .refine((title) => title.trim().length > 0, "A title must not be blank");
/** `YYYY-MM-DD`, or a date-time with optional seconds, fraction and offset. */
const ISO_DATE_OR_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const RealDate = z.iso.date();
// Zod requires seconds beside a zone unless precision is minutes, and the shape allows either.
const RealDateTime = z.union([
  z.iso.datetime({ local: true, offset: true }),
  z.iso.datetime({ local: true, offset: true, precision: -1 }),
]);
/** The shape the model sees, refined to a day and time that exist, so Feb 30 never reaches the user's confirmation. */
const DateOrDateTime = z
  .string()
  .regex(ISO_DATE_OR_TIME, "Use YYYY-MM-DD or an ISO 8601 date-time")
  .refine(
    (value) => RealDate.safeParse(value).success || RealDateTime.safeParse(value).success,
    "Use a real date and time",
  );
const CommandNotes = z.string().max(8000).optional();
const UpdatedEventBoundary = DateOrDateTime.describe(
  "In the event's own form: YYYY-MM-DD for an all-day event, else an ISO 8601 date-time. Keep an offset the source states; without one it is this Mac's local time.",
);
const EventBoundary = DateOrDateTime.describe(
  "ISO 8601 date-time, or YYYY-MM-DD when allDay is true. Without an offset it is this Mac's local time, as typing it into Calendar would be.",
);

/** Typed app commands through the OS's own data frameworks, never a script: allowlisted creates, bounded reads, reminder or event updates by id, and additions to a contact. Nothing is deleted. */
export const AppCommandSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("list_reminder_lists") }),
  z.strictObject({
    name: z.literal("create_reminder"),
    title: CommandTitle,
    notes: CommandNotes,
    due: DateOrDateTime.optional().describe(
      "YYYY-MM-DD for a date-only reminder, or an ISO 8601 date-time (this Mac's local time without an offset).",
    ),
    listId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("An id from list_reminder_lists; omit for the default list."),
    priority: z
      .union([z.literal(0), z.literal(1), z.literal(5), z.literal(9)])
      .optional()
      .describe("0 none, 1 high, 5 medium, 9 low."),
  }),
  z.strictObject({
    name: z.literal("find_reminders"),
    id: z.string().min(1).max(256).optional().describe("Read just this reminder."),
    listId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("An id from list_reminder_lists; omit for every list."),
    titleContains: z.string().min(1).max(256).optional().describe("Case-insensitive part of the title."),
    includeCompleted: z.boolean().optional().describe("Completed reminders are left out unless true."),
  }),
  z
    .strictObject({
      name: z.literal("update_reminder"),
      id: z.string().min(1).max(256).describe("An id from find_reminders or create_reminder."),
      title: CommandTitle.optional(),
      notes: CommandNotes.describe("Replaces the notes; an empty string clears them."),
      due: DateOrDateTime.optional().describe(
        "YYYY-MM-DD for a date-only reminder, or an ISO 8601 date-time (this Mac's local time without an offset).",
      ),
      clearDue: z.literal(true).optional().describe("Removes the due date."),
      priority: z
        .union([z.literal(0), z.literal(1), z.literal(5), z.literal(9)])
        .optional()
        .describe("0 none, 1 high, 5 medium, 9 low."),
      completed: z.boolean().optional().describe("true marks it done; false reopens it."),
    })
    .refine((update) => !(update.due !== undefined && update.clearDue), {
      message: "Pass due or clearDue, not both",
    })
    .refine(
      (update) =>
        [update.title, update.notes, update.due, update.clearDue, update.priority, update.completed].some(
          (value) => value !== undefined,
        ),
      { message: "An update needs at least one field to change" },
    ),
  z.strictObject({ name: z.literal("list_calendars") }),
  z.strictObject({
    name: z.literal("create_event"),
    title: CommandTitle,
    start: EventBoundary,
    end: EventBoundary,
    allDay: z.boolean().optional(),
    location: z.string().max(1024).optional(),
    notes: CommandNotes,
    calendarId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("An id from list_calendars; omit for the default calendar."),
    alertMinutesBefore: z.number().int().min(0).max(40_320).optional(),
  }),
  z
    .strictObject({
      name: z.literal("find_events"),
      id: z.string().min(1).max(256).optional().describe("Read just this event."),
      calendarId: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe("An id from list_calendars; omit for every calendar."),
      from: DateOrDateTime.optional().describe("Range start (this Mac's local time without an offset)."),
      to: DateOrDateTime.optional().describe(
        "Range end, at most 31 days after from; a YYYY-MM-DD end includes that whole day.",
      ),
      titleContains: z.string().min(1).max(256).optional().describe("Case-insensitive part of the title."),
    })
    .refine((find) => find.id !== undefined || (find.from !== undefined && find.to !== undefined), {
      message: "Pass id, or from and to",
    }),
  z
    .strictObject({
      name: z.literal("update_event"),
      id: z
        .string()
        .min(1)
        .max(256)
        .describe("An id from find_events or create_event; repeating events are refused."),
      title: CommandTitle.optional(),
      start: UpdatedEventBoundary.optional(),
      end: UpdatedEventBoundary.optional(),
      location: z.string().max(1024).optional().describe("Replaces the location; an empty string clears it."),
      notes: CommandNotes.describe("Replaces the notes; an empty string clears them."),
    })
    .refine(
      (update) =>
        [update.title, update.start, update.end, update.location, update.notes].some(
          (value) => value !== undefined,
        ),
      { message: "An update needs at least one field to change" },
    ),
  z.strictObject({ name: z.literal("list_contact_groups") }),
  z.strictObject({
    name: z.literal("create_contact_group"),
    title: CommandTitle.describe(
      "Group name; an existing group with this name is returned instead of a duplicate.",
    ),
  }),
  z
    .strictObject({
      name: z.literal("create_contact"),
      givenName: z.string().max(1024).optional(),
      familyName: z.string().max(1024).optional(),
      organization: z.string().max(1024).optional(),
      jobTitle: z.string().max(1024).optional(),
      emails: z.array(z.string().min(3).max(320)).max(5).optional(),
      phones: z.array(z.string().min(1).max(64)).max(5).optional(),
      groupId: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe("An id from list_contact_groups or create_contact_group."),
    })
    .refine(
      (contact) =>
        Boolean(contact.givenName?.trim() || contact.familyName?.trim() || contact.organization?.trim()),
      {
        message: "A contact needs a name or an organization",
      },
    ),
  z
    .strictObject({
      name: z.literal("find_contacts"),
      id: z.string().min(1).max(256).optional().describe("Read just this contact."),
      nameContains: z.string().min(2).max(256).optional().describe("Part of a person's name."),
    })
    .refine((find) => find.id !== undefined || find.nameContains !== undefined, {
      message: "Pass id or nameContains",
    }),
  z
    .strictObject({
      name: z.literal("update_contact"),
      id: z.string().min(1).max(256).describe("An id from find_contacts or create_contact."),
      emails: z
        .array(z.string().min(3).max(320))
        .max(5)
        .optional()
        .describe("Emails to add; existing ones stay."),
      phones: z
        .array(z.string().min(1).max(64))
        .max(5)
        .optional()
        .describe("Phones to add; existing ones stay."),
      groupId: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe("A group from list_contact_groups or create_contact_group to add the contact to."),
    })
    .refine((update) => Boolean(update.emails?.length || update.phones?.length || update.groupId), {
      message: "An update needs an email, phone or group to add",
    }),
]);
export type AppCommand = z.infer<typeof AppCommandSchema>;

/** The computer tool for desktops that support app commands. */
export const ComputerUseWithAppCommandsSchema = z.union([
  ...ComputerUseSchema.options,
  z.strictObject({ action: z.literal("app_command"), command: AppCommandSchema }),
]);
export type ComputerUseWithAppCommandsInput = z.infer<typeof ComputerUseWithAppCommandsSchema>;

export const ComputerUseStatusSchema = z.strictObject({
  kind: z.literal("status"),
  platform: z.literal("darwin"),
  accessibility: z.boolean(),
  screenRecording: z.boolean(),
  reminders: z.enum(["granted", "denied", "not_determined"]).optional(),
  calendars: z.enum(["granted", "denied", "not_determined"]).optional(),
  contacts: z.enum(["granted", "denied", "not_determined"]).optional(),
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

const CommandItem = z.strictObject({
  id: z.string().min(1).max(256),
  title: z.string().max(1024),
  allowsModifications: z.boolean(),
});

const ReminderItem = z.strictObject({
  id: z.string().min(1).max(256),
  title: z.string().max(1024),
  list: z.string().max(1024),
  due: z.string().max(64).optional(),
  priority: z.number().int().min(0).max(9),
  completed: z.boolean(),
  notes: z.string().max(8000).optional(),
});

const EventItem = z.strictObject({
  id: z.string().min(1).max(256),
  title: z.string().max(1024),
  list: z.string().max(1024),
  start: z.string().max(64),
  end: z.string().max(64),
  allDay: z.boolean(),
  recurring: z.boolean(),
  location: z.string().max(1024).optional(),
  notes: z.string().max(8000).optional(),
});

const ContactItem = z.strictObject({
  id: z.string().min(1).max(256),
  title: z.string().max(1024),
  organization: z.string().max(1024).optional(),
});

const SavedItem = z.strictObject({
  id: z.string().min(1).max(256),
  title: z.string().max(1024),
  list: z.string().max(1024),
});

/** A create must return the id it committed, so a lost reply is never retried as a second create. */
export const ComputerUseCommandResultSchema = z
  .strictObject({
    kind: z.literal("command"),
    command: z.enum([
      "list_reminder_lists",
      "create_reminder",
      "find_reminders",
      "update_reminder",
      "list_calendars",
      "create_event",
      "find_events",
      "update_event",
      "list_contact_groups",
      "create_contact_group",
      "create_contact",
      "find_contacts",
      "update_contact",
    ]),
    created: SavedItem.optional(),
    updated: SavedItem.optional(),
    items: z.array(CommandItem).max(200).optional(),
    reminders: z.array(ReminderItem).max(50).optional(),
    events: z.array(EventItem).max(50).optional(),
    contacts: z.array(ContactItem).max(50).optional(),
    truncated: z
      .boolean()
      .optional()
      .describe("True when more items exist than the read returns (200 for lists, 50 for finds)."),
  })
  .refine(
    (result) => {
      if (result.command.startsWith("create_")) return result.created !== undefined;
      if (result.command.startsWith("update_")) return result.updated !== undefined;
      if (result.command === "find_reminders") return result.reminders !== undefined;
      if (result.command === "find_events") return result.events !== undefined;
      if (result.command === "find_contacts") return result.contacts !== undefined;
      return result.items !== undefined;
    },
    {
      message:
        "A create returns created, an update updated, a find its reminders, events or contacts, and a list items",
    },
  );

export const ComputerUseResultSchema = z.discriminatedUnion("kind", [
  ComputerUseStatusSchema,
  ComputerUseCommandResultSchema,
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
        "batch",
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
      if ((result.action === "input_sequence" || result.action === "batch") && !result.sequence)
        ctx.addIssue({
          code: "custom",
          path: ["sequence"],
          message: "Input sequences and batches require dispatch progress",
        });
      if (
        result.action === "batch" &&
        result.sequence &&
        (result.sequence.totalSteps < 2 || result.sequence.totalSteps > 8)
      )
        ctx.addIssue({
          code: "custom",
          path: ["sequence", "totalSteps"],
          message: "A batch has 2 to 8 steps",
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
