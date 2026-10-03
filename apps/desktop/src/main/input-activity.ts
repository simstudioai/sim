import type { InputEvent, WebContents } from 'electron'

/**
 * Input Chromium delivers only because the user did something deliberate.
 *
 * `mouseMove`, `mouseEnter`, `mouseLeave`, `pointerMove` and `pointerRawUpdate`
 * are excluded on purpose: they arrive continuously while the cursor merely
 * rests over the window, so counting them as intent would hand every page a
 * permanently-satisfied gate.
 */
const DELIBERATE_INPUT_TYPES: ReadonlySet<InputEvent['type']> = new Set([
  'keyDown',
  'rawKeyDown',
  'keyUp',
  'char',
  'mouseDown',
  'mouseUp',
  'mouseWheel',
  'touchStart',
  'touchEnd',
  'gestureTap',
])

/**
 * The subset that is one discrete act — a keypress or a click. Wheel and
 * key-up are dropped here: an irreversible operation should follow something
 * the user can point at having done, not an inertial scroll.
 */
const DISCRETE_INPUT_TYPES: ReadonlySet<InputEvent['type']> = new Set([
  'keyDown',
  'rawKeyDown',
  'char',
  'mouseDown',
  'mouseUp',
  'touchEnd',
  'gestureTap',
])

/**
 * Typing and scrolling produce input continuously, so a keystroke-driven
 * terminal write always lands well inside this.
 */
const DELIBERATE_INPUT_WINDOW_MS = 3_000

/**
 * Matches the lifetime of Chromium's transient user activation, which is what
 * the renderer-reported check this replaces was approximating.
 */
const DISCRETE_INPUT_WINDOW_MS = 5_000

interface InputActivity {
  lastDeliberateAt: number
  lastDiscreteAt: number
}

const activityByContents = new WeakMap<WebContents, InputActivity>()

/**
 * A pointer move with a button held down — a drag, which is intent, unlike the
 * resting-cursor stream the passive types are excluded for. Without this a
 * selection drag longer than the window stops counting mid-gesture.
 */
function isDragMove(input: InputEvent): boolean {
  if (input.type !== 'mouseMove') return false
  const modifiers = input.modifiers ?? []
  return (
    modifiers.includes('leftbuttondown') ||
    modifiers.includes('middlebuttondown') ||
    modifiers.includes('rightbuttondown')
  )
}

/**
 * Records real OS input for `contents`.
 *
 * Chromium hands the main process every input event before the renderer sees
 * it, and page script cannot synthesize one — which is the whole point. The
 * gate this feeds used to ask the renderer about `navigator.userActivation`, a
 * value evaluated in the page's own world that a compromised page redefines in
 * one line. Anything derived from renderer-reported state is not a boundary;
 * this is, because the signal never passes through the renderer at all.
 */
export function trackInputActivity(contents: WebContents): void {
  contents.on('input-event', (_event, input) => {
    if (!DELIBERATE_INPUT_TYPES.has(input.type) && !isDragMove(input)) return
    const now = Date.now()
    const discrete = DISCRETE_INPUT_TYPES.has(input.type)
    const activity = activityByContents.get(contents)
    if (!activity) {
      activityByContents.set(contents, {
        lastDeliberateAt: now,
        lastDiscreteAt: discrete ? now : 0,
      })
      return
    }
    activity.lastDeliberateAt = now
    if (discrete) activity.lastDiscreteAt = now
  })
}

/**
 * Whether the user has recently driven this renderer with real input —
 * keystrokes, clicks or wheel. Gates the interactive terminal write path,
 * where the legitimate caller is a person typing into xterm.js.
 */
export function hasRecentDeliberateInput(contents: WebContents): boolean {
  return isWithin(contents, (activity) => activity.lastDeliberateAt, DELIBERATE_INPUT_WINDOW_MS)
}

/**
 * Whether the user recently performed one discrete act in this renderer.
 * Gates the operations with no native confirmation behind them, where the
 * requirement is an actual click or keypress rather than mere activity.
 */
export function hasRecentDiscreteInput(contents: WebContents): boolean {
  return isWithin(contents, (activity) => activity.lastDiscreteAt, DISCRETE_INPUT_WINDOW_MS)
}

/**
 * Whether a recorded stamp is inside its window.
 *
 * A negative elapsed fails the check rather than passing it: `Date.now()` can
 * step backwards on an NTP correction, and `now - then < window` is true for
 * every negative delta, which would leave an arbitrarily old stamp satisfying
 * the gate indefinitely.
 */
function isWithin(
  contents: WebContents,
  stamp: (activity: InputActivity) => number,
  windowMs: number
): boolean {
  if (contents.isDestroyed()) return false
  const activity = activityByContents.get(contents)
  if (!activity) return false
  const elapsed = Date.now() - stamp(activity)
  return elapsed >= 0 && elapsed < windowMs
}
