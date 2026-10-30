/**
 * vCPU and RAM for the Pi sandbox, shared by both provider builds and by sandbox
 * pricing, so the provider Pi fails over to gives it the same machine as the one it
 * normally runs on. A template built without explicit sizes gets E2B's build default
 * of 2 vCPU / 1 GiB, an eighth of the memory Pi gets on Daytona.
 *
 * Memory is the dimension that matters: the Pi CLI is a Node process holding an LLM
 * context, running beside a `git clone` of the user's repository, and Node has no
 * graceful behaviour at its memory ceiling — it is OOM-killed, which reaches the user
 * as an opaque agent failure rather than a diagnosable one.
 *
 * Memory is at E2B's Professional maximum (8192 MB per build) and CPU is half of
 * its 8 vCPU maximum. Sizing is per-second billed against allocated resources rather
 * than used ones, so this costs roughly 3x the E2B build default per sandbox-second.
 * On the compute-bound phases that is close to neutral — the work finishes
 * proportionally sooner — but Babysit deliberately idles between review polls, and
 * idle seconds bill at the same rate. Lower
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
