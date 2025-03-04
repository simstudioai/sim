#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = __importDefault(require("chalk"));
const commander_1 = require("commander");
const update_notifier_1 = __importDefault(require("update-notifier"));
const start_1 = require("./commands/start");
const help_1 = require("./commands/help");
const version_1 = require("./commands/version");
const logo_1 = require("./utils/logo");
const config_1 = require("./utils/config");
// Package info for version checking
const pkg = require('../package.json');
// Check for updates
(0, update_notifier_1.default)({ pkg }).notify();
// Create program
const program = new commander_1.Command();
// Initialize CLI
async function main() {
    // Configure the CLI
    program
        .name('sim')
        .description('Sim Studio CLI')
        .version(pkg.version, '-v, --version', 'Output the current version')
        .helpOption('-h, --help', 'Display help for command')
        .on('--help', () => (0, help_1.help)())
        .action(() => {
        // Default command (no args) runs start with default options
        (0, start_1.start)({ port: config_1.config.get('port'), debug: config_1.config.get('debug') });
    });
    // Start command
    program
        .command('start')
        .description('Start Sim Studio with local storage')
        .option('-p, --port <port>', 'Port to run on', config_1.config.get('port'))
        .option('-d, --debug', 'Enable debug mode', config_1.config.get('debug'))
        .action((options) => {
        (0, start_1.start)(options);
    });
    // Version command
    program
        .command('version')
        .description('Show detailed version information')
        .action(() => {
        (0, version_1.version)();
    });
    // Help command
    program
        .command('help')
        .description('Display help information')
        .action(() => {
        (0, help_1.help)();
    });
    // Display logo if not in help mode
    if (!process.argv.includes('--help') && !process.argv.includes('-h')) {
        console.log(logo_1.logo);
    }
    // Parse arguments
    program.parse(process.argv);
}
// Run the CLI
main().catch((error) => {
    console.error(chalk_1.default.red('Error:'), error);
    process.exit(1);
});
