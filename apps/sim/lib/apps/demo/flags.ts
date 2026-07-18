/**
 * Client-safe Full-stack demo flag.
 * Server code should prefer {@link isFullstackDemoModeEnabled} from runtime.ts
 * (OR of FULLSTACK_DEMO_MODE + this public flag).
 */
export function isFullstackDemoModeClient(): boolean {
  const value = process.env.NEXT_PUBLIC_FULLSTACK_DEMO_MODE
  return value === 'true' || value === '1'
}
