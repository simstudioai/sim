"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logo = void 0;
const chalk_1 = __importDefault(require("chalk"));
/**
 * ASCII art logo for Sim Studio
 */
exports.logo = `
${chalk_1.default.bold(chalk_1.default.magenta(`
  ███████╗██╗███╗   ███╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
  ██╔════╝██║████╗ ████║    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
  ███████╗██║██╔████╔██║    ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
  ╚════██║██║██║╚██╔╝██║    ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
  ███████║██║██║ ╚═╝ ██║    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
  ╚══════╝╚═╝╚═╝     ╚═╝    ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
                                                                         
`))}
${chalk_1.default.cyan('Build, optimize, and test agent workflows with a powerful visual interface')}
`;
