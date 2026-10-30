declare const __SIM_ORIGIN__: string
export const SIM_ORIGIN = __SIM_ORIGIN__
export const CAPTURE_INTENT_KEY = 'captureIntent'
export const CAPTURE_INTENT_TTL_MS = 30_000
export const captureIntentKey = (windowId: number, intentId: string) =>
  `${CAPTURE_INTENT_KEY}:${windowId}:${intentId}`
