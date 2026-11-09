/**
 * Formats a deployment version label so the numeric version is always a short, stable reference.
 * Unnamed versions read as `v3`; named versions keep the number alongside the custom name (`v3 · My name`),
 * so a long, truncated name never hides the shorthand a user can refer to.
 */
export function formatVersionLabel(version: number, name?: string | null): string {
  return name ? `v${version} · ${name}` : `v${version}`
}
