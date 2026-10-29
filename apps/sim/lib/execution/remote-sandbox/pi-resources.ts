/**
 * vCPU and RAM for the Pi sandbox, shared by both provider builds and by sandbox
 * pricing. The two providers had already drifted here. Daytona asked for 4 CPU / 8 GB
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
 * Memory is at E2B's Professional maximum (8192 MB per build) and CPU is half of
 * its 8 vCPU maximum; the minimum is 1 vCPU / 512 MB. Sizing is per-second billed against allocated
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

/**
 * Daytona disk for the Pi sandbox. 10 GB is a hard per-sandbox cap there: the API rejects anything
 * larger regardless of plan tier, and raising it requires contacting Daytona. E2B allows 20 GB, so
 * this bounds how large a repository Pi can clone on the failover provider, and it is the one
 * dimension where the two images legitimately differ.
 */
export const PI_DAYTONA_DISK_GB = 10
