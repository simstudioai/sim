import { Command, Option } from 'commander'
import { installUpdate, type PackageManager } from '#sim-cli/update/install'

export function updateCommand(): Command {
  return new Command('update')
    .description('Update this global CLI installation to the newest release on its channel')
    .addOption(
      new Option('--package-manager <manager>', 'Package manager that installed this copy').choices(
        ['npm', 'pnpm', 'bun', 'yarn']
      )
    )
    .action(async (options: { packageManager?: PackageManager }) => {
      await installUpdate({ packageManager: options.packageManager })
    })
}
