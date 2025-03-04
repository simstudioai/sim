"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.version = version;
const chalk_1 = __importDefault(require("chalk"));
/**
 * Version command displays the current version of the CLI
 */
function version() {
    const pkg = require('../../package.json');
    console.log(`
${chalk_1.default.bold('Sim Studio CLI')} ${chalk_1.default.green(`v${pkg.version}`)}
${chalk_1.default.gray('Platform:')} ${process.platform}
${chalk_1.default.gray('Node Version:')} ${process.version}
${chalk_1.default.gray('CLI Path:')} ${__dirname}
  `);
}
