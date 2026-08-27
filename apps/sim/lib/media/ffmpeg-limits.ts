/**
 * Execution bounds the ffmpeg tool enforces.
 *
 * These are mirrored into the Go tool catalog
 * (`copilot/internal/tools/catalog/other/ffmpeg.go`), which is what lets the
 * router reject an out-of-range argument structurally, before any storage read
 * or child process. The model itself learns the limits from the parameter
 * descriptions — copilot's `NormalizeToolParameters` drops every JSON Schema
 * keyword outside its allowlist on the way to a provider, so the numbers are
 * stated in prose there too. `ffmpeg-schema-parity.test.ts` fails when the two
 * copies drift.
 *
 * `maxScalePixels` has no JSON Schema equivalent, so it lives in the parameter
 * description on the Go side and is enforced here only.
 */
export const FFMPEG_LIMITS = {
  /** Every input costs a full re-encode pass in `concat`, the only multi-input operation. */
  maxInputFiles: 20,
  minScaleDimension: 16,
  maxScaleDimension: 4096,
  /** DCI 4K in either orientation — bounds the square frames the per-axis cap alone allows. */
  maxScalePixels: 4096 * 2304,
} as const
