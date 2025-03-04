/**
 * A simple spinner implementation that doesn't rely on external packages
 */
export declare class SimpleSpinner {
    private interval;
    private frames;
    private frameIndex;
    private isSpinning;
    private lastOutput;
    private _text;
    constructor(text?: string);
    /**
     * Start the spinner
     */
    start(text?: string): SimpleSpinner;
    /**
     * Stop the spinner
     */
    stop(): SimpleSpinner;
    /**
     * Update the spinner text
     */
    set text(value: string);
    /**
     * Get the spinner text
     */
    get text(): string;
    /**
     * Show a success message
     */
    succeed(text?: string): SimpleSpinner;
    /**
     * Show a failure message
     */
    fail(text?: string): SimpleSpinner;
    /**
     * Show a warning message
     */
    warn(text?: string): SimpleSpinner;
    /**
     * Show an info message
     */
    info(text?: string): SimpleSpinner;
    /**
     * Stop the spinner and show a symbol with text
     */
    private stopWithSymbol;
}
/**
 * Create a new spinner
 */
export declare function createSpinner(text?: string): SimpleSpinner;
