"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleSpinner = void 0;
exports.createSpinner = createSpinner;
const chalk_1 = __importDefault(require("chalk"));
/**
 * A simple spinner implementation that doesn't rely on external packages
 */
class SimpleSpinner {
    constructor(text = '') {
        this.interval = null;
        this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.frameIndex = 0;
        this.isSpinning = false;
        this.lastOutput = '';
        this._text = '';
        this._text = text;
    }
    /**
     * Start the spinner
     */
    start(text) {
        if (text) {
            this._text = text;
        }
        if (!this.isSpinning) {
            this.isSpinning = true;
            this.frameIndex = 0;
            // Clear any previous output
            if (this.lastOutput) {
                process.stdout.write('\r' + ' '.repeat(this.lastOutput.length) + '\r');
            }
            this.interval = setInterval(() => {
                const frame = this.frames[this.frameIndex];
                const output = `${chalk_1.default.cyan(frame)} ${this._text}`;
                process.stdout.write('\r' + output);
                this.lastOutput = output;
                this.frameIndex = (this.frameIndex + 1) % this.frames.length;
            }, 80);
        }
        return this;
    }
    /**
     * Stop the spinner
     */
    stop() {
        if (this.isSpinning && this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            this.isSpinning = false;
            // Clear the spinner line
            process.stdout.write('\r' + ' '.repeat(this.lastOutput.length) + '\r');
        }
        return this;
    }
    /**
     * Update the spinner text
     */
    set text(value) {
        this._text = value;
    }
    /**
     * Get the spinner text
     */
    get text() {
        return this._text;
    }
    /**
     * Show a success message
     */
    succeed(text) {
        return this.stopWithSymbol(chalk_1.default.green('✓'), text || this._text);
    }
    /**
     * Show a failure message
     */
    fail(text) {
        return this.stopWithSymbol(chalk_1.default.red('✗'), text || this._text);
    }
    /**
     * Show a warning message
     */
    warn(text) {
        return this.stopWithSymbol(chalk_1.default.yellow('⚠'), text || this._text);
    }
    /**
     * Show an info message
     */
    info(text) {
        return this.stopWithSymbol(chalk_1.default.blue('ℹ'), text || this._text);
    }
    /**
     * Stop the spinner and show a symbol with text
     */
    stopWithSymbol(symbol, text) {
        this.stop();
        console.log(`${symbol} ${text}`);
        return this;
    }
}
exports.SimpleSpinner = SimpleSpinner;
/**
 * Create a new spinner
 */
function createSpinner(text) {
    return new SimpleSpinner(text);
}
