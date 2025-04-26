export declare class IpConverter {
    private static isIPv4;
    private static parseIPv4;
    private static parseIPv6;
    private static expandIPv6;
    private static formatIPv6;
    private static compressIPv6;
    private static parseCIDR;
    private static decodeIP;
    static toString(buf: ArrayBuffer): string;
    static fromString(text: string): ArrayBuffer;
}
