import { IAsnConvertible, IEmptyConstructor } from "./types";
export declare function isConvertible(target: IEmptyConstructor): target is new () => IAsnConvertible;
export declare function isConvertible(target: unknown): target is IAsnConvertible;
export declare function isTypeOfArray(target: unknown): target is typeof Array;
export declare function isArrayEqual(bytes1: ArrayBuffer, bytes2: ArrayBuffer): boolean;
