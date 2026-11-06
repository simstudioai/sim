import { Command } from 'commander'
import {
  builtInIngestTarget,
  DO_NOT_TRACK_VARIABLE,
  loadTelemetryState,
  TELEMETRY_DISABLED_VARIABLE,
  type TelemetryStatus,
  telemetryStatus,
  writeTelemetryState,
} from '../telemetry/index'
import { USAGE_DATA_DOCS_URL } from '../telemetry/invocation'

/** One line per state, naming the thing the user can change when it is off. */
function describe(status: TelemetryStatus): string {
  if (status.enabled) return 'Usage reporting is on.'
  switch (status.reason) {
    case 'do_not_track':
      return `Usage reporting is off: ${DO_NOT_TRACK_VARIABLE} is set.`
    case 'environment':
      return `Usage reporting is off: ${TELEMETRY_DISABLED_VARIABLE} is set.`
    case 'setting':
      return 'Usage reporting is off. Turn it on with: sim telemetry enable'
    case 'unconfigured':
      return 'Usage reporting is off: this build has no reporting destination.'
  }
}

function currentStatus(): TelemetryStatus {
  return telemetryStatus({
    env: process.env,
    state: loadTelemetryState(),
    configured: builtInIngestTarget() !== undefined,
  })
}

/**
 * Saves the setting, then reports the resulting state rather than the saved
 * value: `enable` under `DO_NOT_TRACK=1` must not print "on" when nothing
 * will be sent.
 */
function setEnabled(enabled: boolean): void {
  writeTelemetryState({ ...loadTelemetryState(), enabled })
  console.log(describe(currentStatus()))
}

export function telemetryCommand(): Command {
  const telemetry = new Command('telemetry').description('Control anonymous usage reporting')

  telemetry
    .command('status')
    .description('Show usage-reporting status')
    .addHelpText(
      'after',
      'Telemetry commands always print text. DO_NOT_TRACK and SIM_TELEMETRY_DISABLED override the saved preference; a build without a reporting destination remains off. See the usage-data guide for the data collected.'
    )
    .action(() => {
      console.log(describe(currentStatus()))
      console.log(`Learn more: ${USAGE_DATA_DOCS_URL}`)
    })

  telemetry
    .command('enable')
    .description('Enable the usage-reporting preference for this machine')
    .action(() => setEnabled(true))

  telemetry
    .command('disable')
    .description('Turn usage reporting off for this machine')
    .action(() => setEnabled(false))

  return telemetry
}
