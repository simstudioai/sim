import { PHASES } from '@/scripts/org-redesign-e2e/checks/phases'
import { finishRun, healthCheck, phase, startRun } from '@/scripts/org-redesign-e2e/harness'

/**
 * Acceptance for the organization view against a hosted production build, real Postgres and Redis,
 * and a scripted model. Walks what each persona could see and do before the redesign, as behaviour:
 * every section's rows are present and work, in both themes at both widths, with no runtime error
 * and no failed same-origin request. One failed check never stops the walk, so a run reports them
 * all. Google answers only to real credentials, so the widget reads are replaced at the browser's
 * network boundary; `home-widgets.integration.ts` proves the reads behind them.
 *
 * Requires ORG_REDESIGN_E2E_ORIGIN, ORG_REDESIGN_E2E_DATABASE_URL, ORG_REDESIGN_E2E_AUTH_SECRET and
 * ORG_REDESIGN_E2E_REPORT_PATH. ORG_REDESIGN_E2E_PHASE picks `main`, or `people` for an app started
 * with the People flag on.
 */
async function run() {
  await startRun()
  const checks = PHASES[phase]
  if (!checks) throw new Error(`Unknown ORG_REDESIGN_E2E_PHASE: ${phase}`)
  for (const phaseChecks of checks) await phaseChecks()
  await healthCheck()
}

await run().then(
  () => finishRun(),
  (error: unknown) => finishRun(error)
)
