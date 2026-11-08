/**
 * A ref that writes one runtime-measured property onto its element, for the grid's geometry that
 * only exists at runtime: column widths, sticky offsets, spacer heights and overlay boxes. Static
 * geometry stays in the CSS Module; this carries only values computed from the data.
 */
export function inlineStyle(property: string, value: string | null) {
  return (element: HTMLElement | null) => {
    if (!element) return
    if (value === null) element.style.removeProperty(property)
    else element.style.setProperty(property, value)
  }
}

/** Several runtime-measured properties at once; `null` clears one. */
export function inlineStyles(properties: Readonly<Record<string, string | null>>) {
  return (element: HTMLElement | null) => {
    if (!element) return
    for (const [property, value] of Object.entries(properties)) {
      if (value === null) element.style.removeProperty(property)
      else element.style.setProperty(property, value)
    }
  }
}
