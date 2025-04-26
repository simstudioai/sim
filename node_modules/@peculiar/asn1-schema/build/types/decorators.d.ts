import { AsnPropTypes, AsnTypeTypes } from "./enums";
import { IAsnConverter, IEmptyConstructor } from "./types";
export type AsnItemType<T = unknown> = AsnPropTypes | IEmptyConstructor<T>;
export interface IAsn1TypeOptions {
    type: AsnTypeTypes;
    itemType?: AsnItemType;
}
export type AsnRepeatTypeString = "sequence" | "set";
export type AsnRepeatType = AsnRepeatTypeString;
export interface IAsn1PropOptions {
    type: AsnItemType;
    optional?: boolean;
    defaultValue?: unknown;
    context?: number;
    implicit?: boolean;
    converter?: IAsnConverter;
    repeated?: AsnRepeatType;
}
export type AsnTypeDecorator = (target: IEmptyConstructor) => void;
export declare const AsnType: (options: IAsn1TypeOptions) => AsnTypeDecorator;
export declare const AsnChoiceType: () => AsnTypeDecorator;
export interface IAsn1SetOptions {
    itemType: AsnItemType;
}
export declare const AsnSetType: (options: IAsn1SetOptions) => AsnTypeDecorator;
export interface IAsn1SequenceOptions {
    itemType?: AsnItemType;
}
export declare const AsnSequenceType: (options: IAsn1SequenceOptions) => AsnTypeDecorator;
export type AsnPropDecorator = (target: object, propertyKey: string) => void;
export declare const AsnProp: (options: IAsn1PropOptions) => AsnPropDecorator;
