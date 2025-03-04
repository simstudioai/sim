interface StartOptions {
    port: string;
    debug: boolean;
}
/**
 * Start command that launches Sim Studio using local storage
 */
export declare function start(options: StartOptions): Promise<import("child_process").ChildProcess>;
export {};
