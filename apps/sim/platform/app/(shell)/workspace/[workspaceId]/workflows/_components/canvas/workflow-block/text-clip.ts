/** Whether an element's content is wider than its visible box. */
export function isTextClipped(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1
}
