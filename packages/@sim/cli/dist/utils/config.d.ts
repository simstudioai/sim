import Conf from 'conf';
interface ConfigSchema {
    port: string;
    debug: boolean;
    lastRun: string;
}
export declare const config: Conf<ConfigSchema>;
export {};
