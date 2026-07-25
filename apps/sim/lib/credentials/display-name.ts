/** Server-enforced max for `WorkspaceCredential.displayName` — see `lib/api/contracts/credentials.ts`. */
export const DISPLAY_NAME_MAX_LENGTH = 255

/**
 * Reserved tail budget when truncating the username so the auto-numbering
 * disambiguator (e.g. `" 9999"`) always fits within {@link DISPLAY_NAME_MAX_LENGTH}.
 */
const COLLISION_SUFFIX_RESERVATION = 5

/** Upper bound for the auto-numbering search — pathological if ever reached. */
const MAX_COLLISION_INDEX = 10000

/**
 * Default credential display name. Produces `"{Name}'s {Service}"` when the
 * user's name is known, falling back to `"My {Service}"` otherwise. The
 * username is truncated so the full string (including any auto-numbering
 * disambiguator) stays within {@link DISPLAY_NAME_MAX_LENGTH}.
 *
 * When the base name collides with an existing credential in `takenNames`,
 * `" 2"`, `" 3"`, ... are appended until an unused name is found. `takenNames`
 * must contain lowercased names; comparison is case-insensitive to match the
 * duplicate-detection in the connect modal.
 */
export function defaultCredentialDisplayName(
  userName: string | null | undefined,
  serviceName: string,
  takenNames: ReadonlySet<string>
): string {
  const trimmed = userName?.trim()
  let base: string
  if (trimmed) {
    const suffix = `'s ${serviceName}`
    const nameBudget = Math.max(
      0,
      DISPLAY_NAME_MAX_LENGTH - suffix.length - COLLISION_SUFFIX_RESERVATION
    )
    const safeName = trimmed.length > nameBudget ? trimmed.slice(0, nameBudget) : trimmed
    base = `${safeName}${suffix}`
  } else {
    base = `My ${serviceName}`
  }

  if (!takenNames.has(base.toLowerCase())) return base
  for (let n = 2; n < MAX_COLLISION_INDEX; n++) {
    const candidate = `${base} ${n}`
    if (!takenNames.has(candidate.toLowerCase())) return candidate
  }
  return base
}
