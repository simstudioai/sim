"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.help = help;
const chalk_1 = __importDefault(require("chalk"));
const logo_1 = require("../utils/logo");
/**
 * Help command displays the logo and usage information
 */
function help() {
    // Display logo
    console.log(logo_1.logo);
    // Display help text
    console.log(`
${chalk_1.default.bold('USAGE')}
  ${chalk_1.default.cyan('sim')}                    Start Sim Studio with default settings
  ${chalk_1.default.cyan('sim start')}              Start Sim Studio with options
  ${chalk_1.default.cyan('sim version')}            Display version information
  ${chalk_1.default.cyan('sim help')}               Show this help information

${chalk_1.default.bold('OPTIONS')}
  ${chalk_1.default.cyan('-p, --port <port>')}      Specify port (default: 3000)
  ${chalk_1.default.cyan('-d, --debug')}            Enable debug mode
  ${chalk_1.default.cyan('-v, --version')}          Show version information
  ${chalk_1.default.cyan('-h, --help')}             Show help information

${chalk_1.default.bold('EXAMPLES')}
  ${chalk_1.default.gray('# Start with default settings')}
  ${chalk_1.default.cyan('$ sim')}

  ${chalk_1.default.gray('# Start on a specific port')}
  ${chalk_1.default.cyan('$ sim start --port 8080')}

  ${chalk_1.default.gray('# Start with debug logging')}
  ${chalk_1.default.cyan('$ sim start --debug')}

${chalk_1.default.bold('DOCUMENTATION')}
  ${chalk_1.default.gray('For more information:')}
  https://github.com/simstudioai/sim
  `);
}
