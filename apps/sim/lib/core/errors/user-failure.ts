/**
 * A failure the workflow author caused and can fix: a missing required field, a block that is not
 * deployed, a call chain nested too deep. `classifyFailure` attributes any subclass to the author,
 * so it logs at info wherever it surfaces. Dependency-free so client-reachable code can throw it.
 */
export class UserFailure extends Error {}
