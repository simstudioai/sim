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

/** Bun version mirrored from the root packageManager field. */
export const PI_BUN_VERSION = '1.4.4'

/** Exact Pi version mirrored from the app dependencies and lockfile. */
export const PI_PACKAGE_VERSION = '1.0.0'

/** Exact global package versions mirrored from package.json and bun.lock. */
export const PI_GLOBAL_NPM_PACKAGES = [
  `bun@${PI_BUN_VERSION}`,
  `@earendil-works/pi-coding-agent@${PI_PACKAGE_VERSION}`,
  `@earendil-works/pi-agent-core@${PI_PACKAGE_VERSION}`,
  `@earendil-works/pi-ai@${PI_PACKAGE_VERSION}`,
  `@earendil-works/pi-tui@${PI_PACKAGE_VERSION}`,
] as const

/**
 * `git`/`gh`/`openssh-client` back the clone → commit → push flow. `ripgrep` is
 * required, not optional: the review tools shell out to the `rg` binary by name
 * (`cloud-review-tools-script.ts:146`), so a missing package breaks code search
 * at runtime rather than at build time.
 *
 * The token-bearing push invokes git as `/usr/bin/git` (`cloud-shared.ts`'s
 * `PUSH_SCRIPT`) so a shim planted earlier on `$PATH` is not what runs. Both
 * images apt-install git on Debian, which puts it there — moving off Debian or
 * off the distro package would break that command.
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
 * Pi 1.0 requires Node >= 22.19 — higher than the Node 20 both the E2B base and
 * the other two sandbox images carry, so this image installs its own.
 */
export const PI_NODE_MAJOR = 22

/** Fails the build loudly if the installed Node is older than Pi supports. */
export const PI_NODE_VERSION_ASSERT =
  'node -e "const [major, minor] = process.versions.node.split(\'.\').map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)"'

/** Fails the build loudly if the sandbox does not contain the repository's Bun version. */
export const PI_BUN_VERSION_ASSERT = `test "$(bun --version)" = "${PI_BUN_VERSION}"`
