"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const conf_1 = __importDefault(require("conf"));
// Create a config instance with default values
exports.config = new conf_1.default({
    projectName: 'sim-studio',
    defaults: {
        port: '3000',
        debug: false,
        lastRun: new Date().toISOString(),
    },
});
