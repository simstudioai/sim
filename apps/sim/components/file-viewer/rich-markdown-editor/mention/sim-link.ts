/**
 * The link scheme for `@`-mention links — `[label](sim:<kind>/<id>)`. Matches the chat composer's
 * portable chip format (`chip-clipboard-codec.ts`), so a mention authored here is parseable there.
 */
export const SIM_LINK_SCHEME = 'sim'

/** Builds the link target for a mention of `kind`/`id`. */
export function toSimHref(kind: string, id: string): string {
  return `${SIM_LINK_SCHEME}:${kind}/${id}`
}
