import chalk from 'chalk'

/**
 * A simple spinner implementation that doesn't rely on external packages
 */
export class SimpleSpinner {
  private interval: NodeJS.Timeout | null = null
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private frameIndex = 0
  private isSpinning = false
  private lastOutput = ''
  private _text: string = ''

  constructor(text: string = '') {
    this._text = text
  }

  /**
   * Start the spinner
   */
  start(text?: string): SimpleSpinner {
    if (text) {
      this._text = text
    }

    if (!this.isSpinning) {
      this.isSpinning = true
      this.frameIndex = 0

      // Clear any previous output
      if (this.lastOutput) {
        process.stdout.write('\r' + ' '.repeat(this.lastOutput.length) + '\r')
      }

      this.interval = setInterval(() => {
        const frame = this.frames[this.frameIndex]
        const output = `${chalk.cyan(frame)} ${this._text}`

        process.stdout.write('\r' + output)
        this.lastOutput = output

        this.frameIndex = (this.frameIndex + 1) % this.frames.length
      }, 80)
    }

    return this
  }

  /**
   * Stop the spinner
   */
  stop(): SimpleSpinner {
    if (this.isSpinning && this.interval) {
      clearInterval(this.interval)
      this.interval = null
      this.isSpinning = false

      // Clear the spinner line
      process.stdout.write('\r' + ' '.repeat(this.lastOutput.length) + '\r')
    }

    return this
  }

  /**
   * Update the spinner text
   */
  set text(value: string) {
    this._text = value
  }

  /**
   * Get the spinner text
   */
  get text(): string {
    return this._text
  }

  /**
   * Show a success message
   */
  succeed(text?: string): SimpleSpinner {
    return this.stopWithSymbol(chalk.green('✓'), text || this._text)
  }

  /**
   * Show a failure message
   */
  fail(text?: string): SimpleSpinner {
    return this.stopWithSymbol(chalk.red('✗'), text || this._text)
  }

  /**
   * Show a warning message
   */
  warn(text?: string): SimpleSpinner {
    return this.stopWithSymbol(chalk.yellow('⚠'), text || this._text)
  }

  /**
   * Show an info message
   */
  info(text?: string): SimpleSpinner {
    return this.stopWithSymbol(chalk.blue('ℹ'), text || this._text)
  }

  /**
   * Stop the spinner and show a symbol with text
   */
  private stopWithSymbol(symbol: string, text: string): SimpleSpinner {
    this.stop()
    console.log(`${symbol} ${text}`)
    return this
  }
}

/**
 * Create a new spinner
 */
export function createSpinner(text?: string): SimpleSpinner {
  return new SimpleSpinner(text)
}
