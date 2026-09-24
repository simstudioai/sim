/**
 * Keep preview fields noninteractive while showing intentionally read-only controls
 * and their marked value overlays at full opacity in both preview sections.
 */
export const READONLY_PREVIEW_STYLES = `
  .readonly-preview,
  .readonly-preview * {
    cursor: default !important;
  }
  .readonly-preview [data-preview-readonly] :is(
    input,
    textarea,
    [role="combobox"],
    [role="slider"],
    [role="switch"],
    [role="checkbox"]
  ) {
    opacity: 1 !important;
    pointer-events: none;
  }
  .readonly-preview [data-preview-readonly] :is(button, [role="button"]) {
    pointer-events: none;
  }
  .readonly-preview [data-preview-readonly] [data-preview-full-opacity] {
    opacity: 1 !important;
  }
`
