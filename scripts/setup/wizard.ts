import { spawnSync } from 'node:child_process'
import { showBanner } from './banner.ts'
import { loadCheckContext, runChecks } from './checks.ts'
import { type Detection, runDetection } from './detect.ts'
import { archiveEnvFile, ROOT } from './env-files.ts'
import { runComposeMode } from './modes/compose.ts'
import { runDevMode } from './modes/dev.ts'
import { runK8sMode } from './modes/k8s.ts'
import * as p from './prompter.ts'
import { glyph, theme } from './theme.ts'

export type WizardMode = 'compose' | 'dev' | 'k8s'

export interface WizardFlags {
  quick: boolean
  mode?: WizardMode
}

async function handleExistingConfig(detection: Detection): Promise<'continue' | 'doctor'> {
  // Root counts: a compose install writes only `.env`, so excluding it made a
  // configured machine look unconfigured and silently re-run from scratch.
  const present = Object.entries(detection.envFiles)
    .filter(([, exists]) => exists)
    .map(([target]) => (target === 'root' ? '.env' : `${target}/.env`))
  if (present.length === 0) return 'continue'
  const choice = await p.select({
    message: `Found existing config (${present.join(', ')}) — what should we do?`,
    options: [
      { value: 'keep', label: 'Keep it', hint: 'run doctor against the current setup and exit' },
      {
        value: 'review',
        label: 'Review and update',
        hint: 'walk the wizard with current values prefilled',
      },
      { value: 'reset', label: 'Reset', hint: 'archive current .env files and start fresh' },
    ],
    initialValue: 'keep',
  })
  if (choice === 'keep') return 'doctor'
  if (choice === 'reset') {
    for (const target of ['sim', 'realtime', 'db', 'root'] as const) {
      const backup = archiveEnvFile(target)
      if (backup) p.log.step(`Archived ${backup}`)
    }
  }
  return 'continue'
}

const LOW_DOCKER_MEM_GB = 6
const LOW_DISK_GB = 15

async function selectMode(detection: Detection, flags: WizardFlags): Promise<WizardMode> {
  if (flags.mode) return flags.mode
  const { dockerMemGb } = detection.specs
  const vm = dockerMemGb !== null ? ` · VM ${dockerMemGb}GB` : ''
  return p.select({
    message: 'How do you want to run Sim?',
    options: [
      {
        value: 'compose',
        label: 'Docker Compose',
        hint: detection.dockerRunning
          ? `Docker running ✓${vm} — simplest, everything bundled`
          : 'Docker is NOT running',
      },
      {
        value: 'dev',
        label: 'Local dev (bun run dev:full)',
        hint: 'for working on Sim itself — app :3000 + realtime :3002',
      },
      {
        value: 'k8s',
        label: 'Kubernetes (helm)',
        hint: detection.kubeContext
          ? `context: ${detection.kubeContext}${vm}`
          : detection.binaries.kind
            ? `kind available${vm}`
            : 'needs kind or Docker Desktop k8s',
      },
    ],
    initialValue: detection.dockerRunning ? 'compose' : 'dev',
  })
}

/** Spec warnings before committing to a mode — informed choice, no silent degradation. */
function warnLowSpecs(detection: Detection, mode: WizardMode): void {
  const { dockerMemGb, freeDiskGb } = detection.specs
  if (
    (mode === 'compose' || mode === 'k8s') &&
    dockerMemGb !== null &&
    dockerMemGb < LOW_DOCKER_MEM_GB
  ) {
    p.log.warn(
      `Docker's VM has only ${dockerMemGb}GB of memory${mode === 'k8s' ? ' — pods will likely sit Pending or OOM' : ' — containers may OOM'}. Raise it in Docker Desktop → Settings → Resources (8GB+ recommended).`
    )
  }
  if ((mode === 'compose' || mode === 'k8s') && freeDiskGb !== null && freeDiskGb < LOW_DISK_GB) {
    p.log.warn(`Only ${freeDiskGb}GB of free disk — image pulls need 5-10GB.`)
  }
}

async function finalVerify(): Promise<void> {
  const findings = await runChecks(loadCheckContext(true), ['live'])
  for (const finding of findings) {
    console.log(` ${glyph[finding.status]} ${finding.message}`)
  }
}

export async function runWizard(flags: WizardFlags): Promise<void> {
  // Detection is ~600ms of subprocess work and the banner is ~600ms of animation
  // with nothing to do — overlap them so the spinner below usually resolves at once.
  const detecting = runDetection()
  await showBanner()

  const spin = p.spinner()
  spin.start('Looking at what you already have…')
  const detection = await detecting
  spin.stop(
    `Detected: docker ${detection.dockerRunning ? '✓' : '✗'} · postgres ${detection.postgresPortOpen ? '✓' : '✗'} · ` +
      `${detection.shellLlmKeys.length} shell LLM key${detection.shellLlmKeys.length === 1 ? '' : 's'}` +
      (detection.kubeContext ? ` · kube: ${detection.kubeContext}` : '')
  )

  if ((await handleExistingConfig(detection)) === 'doctor') {
    const { runDoctor } = await import('./doctor.ts')
    process.exitCode = await runDoctor({ fix: false, json: false })
    return
  }

  const quick =
    flags.quick ||
    (await p.select({
      message: 'Setup style?',
      options: [
        { value: 'quick', label: 'Quick', hint: 'sensible defaults, minimal questions' },
        {
          value: 'custom',
          label: 'Custom',
          hint: 'every option: redis, trigger.dev, image variants',
        },
      ],
      initialValue: 'quick',
    })) === 'quick'

  const mode = await selectMode(detection, flags)
  warnLowSpecs(detection, mode)
  let startDevNow = false
  let devScript = 'dev:full'
  if (mode === 'compose') await runComposeMode(detection, quick)
  else if (mode === 'dev') {
    const dev = await runDevMode(detection, quick)
    startDevNow = dev.startNow
    devScript = dev.script
  } else await runK8sMode(detection)

  if (mode !== 'k8s' && !startDevNow) await finalVerify()

  const url = 'http://localhost:3000'
  p.note(
    [
      mode === 'k8s' ? `port-forward, then open ${url}` : `open ${url}`,
      'check your setup anytime:  bun run doctor',
      mode === 'dev' && !startDevNow ? `start Sim:  bun run ${devScript}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    'Next steps'
  )
  p.outro(theme.accent('Sim is ready.'))

  if (mode === 'compose' && process.platform === 'darwin') {
    spawnSync('open', [url], { stdio: 'ignore' })
  }
  if (startDevNow) {
    const child = spawnSync('bun', ['run', devScript], { cwd: ROOT, stdio: 'inherit' })
    process.exitCode = child.status ?? 0
  }
}
