/**
 * @vitest-environment node
 */
import { promoteAllPlatformAdmins } from '@/lib/billing/platform-admin'

async function main(): Promise<void> {
  const promoted = await promoteAllPlatformAdmins()
  console.log(`Platform admin seed complete (promoted ${promoted} user(s))`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
