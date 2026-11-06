/** A count with its noun, for the regular plurals product copy needs: `1 member`, `3 members`. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
