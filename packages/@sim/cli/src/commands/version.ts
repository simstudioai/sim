import chalk from 'chalk'

/**
 * Version command displays the current version of the CLI
 */
export function version() {
  const pkg = require('../../package.json')

  console.log(`
${chalk.bold('Sim Studio CLI')} ${chalk.green(`v${pkg.version}`)}
${chalk.gray('Platform:')} ${process.platform}
${chalk.gray('Node Version:')} ${process.version}
${chalk.gray('CLI Path:')} ${__dirname}
  `)
}
