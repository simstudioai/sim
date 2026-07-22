/**
 * The single source of truth for what goes into the Pi sandbox image.
 *
 * Two renderers consume these lists:
 *   - `build-pi-e2b-template.ts`      — E2B template, via the `Template()` builder DSL
 *   - `build-pi-daytona-snapshot.ts`  — Daytona snapshot, via the `Image` builder
 *
 * A package added here reaches both providers. Adding one to only a single
 * renderer is the drift that makes a failover fail at the worst moment.
 *
 * The copilot repo holds the equivalent lists for the shell and doc sandboxes
 * (`copilot/scripts/sandbox/packages.ts`); the Pi image lives here because Sim
 * owns the Pi block.
 */

/** Exact first-party Pi versions mirrored from bun.lock — image builds run npm independently. */
export const PI_NPM = [
  '@earendil-works/pi-coding-agent@0.80.10',
  '@earendil-works/pi-agent-core@0.80.10',
  '@earendil-works/pi-ai@0.80.10',
  '@earendil-works/pi-tui@0.80.10',
] as const

/**
 * `git`/`gh`/`openssh-client` back the clone → commit → push flow. `ripgrep` is
 * required, not optional: the review tools shell out to the `rg` binary by name
 * (`cloud-review-tools-script.ts:146`), so a missing package breaks code search
 * at runtime rather than at build time.
 */
export const PI_APT = [
  'git',
  'gh',
  'openssh-client',
  'ca-certificates',
  'ripgrep',
  'fd-find',
] as const

/**
 * Pi 0.80 requires Node >= 22.19 — higher than the Node 20 both the E2B base and
 * the other two sandbox images carry, so this image installs its own.
 */
export const PI_NODE_MAJOR = 22

/** Fails the build loudly if the installed Node is older than Pi supports. */
export const PI_NODE_VERSION_ASSERT =
  'node -e "const [major, minor] = process.versions.node.split(\'.\').map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)"'

/**
 * The review tools run `python3 /workspace/sim-review-tools.py`
 * (`cloud-review-tools.ts:15`). E2B's `code-interpreter-v1` base ships Python, so
 * only the Daytona image has to provide it explicitly.
 */
export const PI_REQUIRES_PYTHON3 = true
