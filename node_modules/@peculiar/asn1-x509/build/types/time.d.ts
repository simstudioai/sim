/**
 * ```asn1
 * Time ::= CHOICE {
 *   utcTime        UTCTime,
 *   generalTime    GeneralizedTime }
 * ```
 */
export declare class Time {
    utcTime?: Date;
    generalTime?: Date;
    constructor(time?: Date | string | number | Partial<Time>);
    getTime(): Date;
}
