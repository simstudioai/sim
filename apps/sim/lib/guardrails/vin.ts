/**
 * Vehicle Identification Number (VIN) recognition.
 *
 * Presidio has no built-in VIN recognizer, and a VIN is pure pattern + arithmetic
 * (no NLP), so it lives here in TS rather than in the Presidio sidecars. A VIN is
 * 17 chars from A-Z/0-9 excluding I/O/Q; this validates the ISO 3779 check digit
 * (position 9), which makes accidental matches on arbitrary 17-char codes (request
 * ids, SKUs, tokens) extremely unlikely. Some non-North-American VINs omit the
 * check digit and are skipped — an intentional bias toward precision.
 */

const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/g

/** Character → numeric value for the ISO 3779 weighted-sum check digit. */
const TRANSLIT: Record<string, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
}

/** Positional weights; index 8 (position 9) is the check digit itself (weight 0). */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

const VIN_PLACEHOLDER = '<VIN>'

/** Whether a 17-char candidate satisfies the ISO 3779 check digit at position 9. */
export function isValidVin(candidate: string): boolean {
  const vin = candidate.toUpperCase()
  if (vin.length !== 17) return false
  let total = 0
  for (let i = 0; i < 17; i++) {
    const value = TRANSLIT[vin[i]]
    if (value === undefined) return false
    total += value * WEIGHTS[i]
  }
  const check = total % 11
  const expected = check === 10 ? 'X' : String(check)
  return vin[8] === expected
}

/** Spans of every check-digit-valid VIN in `text`, in order of appearance. */
export function findVins(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  for (const match of text.matchAll(VIN_PATTERN)) {
    if (match.index === undefined) continue
    if (isValidVin(match[0])) {
      spans.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return spans
}

/** Replace every check-digit-valid VIN in `text` with `<VIN>`. */
export function maskVins(text: string): string {
  return text.replace(VIN_PATTERN, (candidate) =>
    isValidVin(candidate) ? VIN_PLACEHOLDER : candidate
  )
}
