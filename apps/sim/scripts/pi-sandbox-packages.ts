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
export const PI_BUN_VERSION = '1.4.1'

/** Exact Pi version mirrored from the app dependencies and lockfile. */
export const PI_PACKAGE_VERSION = '0.80.10'

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
 * Pi 0.80 requires Node >= 22.19 — higher than the Node 20 both the E2B base and
 * the other two sandbox images carry, so this image installs its own.
 */
export const PI_NODE_MAJOR = 22

/** Fails the build loudly if the installed Node is older than Pi supports. */
export const PI_NODE_VERSION_ASSERT =
  'node -e "const [major, minor] = process.versions.node.split(\'.\').map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)"'

/** Fails the build loudly if the sandbox does not contain the repository's Bun version. */
export const PI_BUN_VERSION_ASSERT = `test "$(bun --version)" = "${PI_BUN_VERSION}"`

/**
 * vCPU and RAM for the Pi sandbox, shared for the same reason the package lists
 * are: the two providers had already drifted here. Daytona asked for 4 CPU / 8 GB
 * while the E2B template asked for nothing and inherited its base default of
 * 2 vCPU / 512 MB — a 16x memory gap between the provider Pi normally runs on and
 * the one it fails over to, which would surface as the agent being killed on E2B
 * for work that succeeded on Daytona.
 *
 * 512 MB is the real problem: the Pi CLI is a Node process holding an LLM
 * context, running beside a `git clone` of the user's repository, and Node has no
 * graceful behaviour at that ceiling — it is OOM-killed, which reaches the user
 * as an opaque agent failure rather than a diagnosable one.
 *
 * Both numbers are at E2B's Professional maximum (8 vCPU / 8192 MB per build,
 * 1 vCPU / 512 MB minimum). Sizing is per-second billed against allocated
 * resources rather than used ones, so this costs roughly 3x the previous E2B
 * default per sandbox-second. On the compute-bound phases that is close to
 * neutral — the work finishes proportionally sooner — but Babysit deliberately
 * idles between review polls, and idle seconds bill at the same rate. Lower
 * {@link PI_SANDBOX_CPU_COUNT} first if that idle time proves dominant: vCPU is
 * ~3x the hourly rate of a GB of RAM, and RAM is the dimension that prevents
 * hard failures.
 */
export const PI_SANDBOX_CPU_COUNT = 4

/** Kept in GB and MB because Daytona takes GB and E2B takes MB. */
export const PI_SANDBOX_MEMORY_GB = 8
export const PI_SANDBOX_MEMORY_MB = PI_SANDBOX_MEMORY_GB * 1024
