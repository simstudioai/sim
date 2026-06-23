import { findVins } from '@/lib/guardrails/vin'

/**
 * A custom PII recognizer for entities Microsoft Presidio doesn't ship.
 *
 * A recognizer only does **detection** — it returns character spans. Masking is
 * handled uniformly by the anonymizer sidecar, which replaces every span by its
 * `entityType` (e.g. `<VIN>`), so a recognizer never touches the sidecars or the
 * masking path.
 *
 * To add one:
 * 1. Implement a pure `detect(text)` (regex/checksum/etc., no I/O).
 * 2. Register it in {@link CUSTOM_RECOGNIZERS}.
 * 3. Add its entity to `pii-entities.ts` so it appears in the Data Retention UI.
 */
export interface CustomRecognizer {
  /** Entity name; becomes the `<ENTITY>` placeholder when masked. */
  entityType: string
  /** Character spans of confirmed matches in `text`. Pure — no I/O. */
  detect(text: string): Array<{ start: number; end: number }>
}

/** The registry of TS-side recognizers, applied on top of Presidio's built-ins. */
export const CUSTOM_RECOGNIZERS: CustomRecognizer[] = [{ entityType: 'VIN', detect: findVins }]

/** Entity names owned by a custom recognizer — never forwarded to the analyzer. */
export const CUSTOM_ENTITY_TYPES = new Set(CUSTOM_RECOGNIZERS.map((r) => r.entityType))
