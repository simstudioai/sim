import { BufferSource } from "pvtsutils";
import { IEmptyConstructor } from "./types";
export declare class AsnConvert {
    static serialize(obj: unknown): ArrayBuffer;
    static parse<T>(data: BufferSource, target: IEmptyConstructor<T>): T;
    /**
     * Returns a string representation of an ASN.1 encoded data
     * @param data ASN.1 encoded buffer source
     * @returns String representation of ASN.1 structure
     */
    static toString(data: BufferSource): string;
    /**
     * Returns a string representation of an ASN.1 schema
     * @param obj Object which can be serialized to ASN.1 schema
     * @returns String representation of ASN.1 structure
     */
    static toString(obj: unknown): string;
}
