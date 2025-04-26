import * as asn1js from "asn1js";
import { AsnRepeatType } from "./decorators";
import { AsnPropTypes, AsnTypeTypes } from "./enums";
import { IAsnConverter, IEmptyConstructor } from "./types";
export interface IAsnSchemaItem {
    type: AsnPropTypes | IEmptyConstructor;
    optional?: boolean;
    defaultValue?: unknown;
    context?: number;
    implicit?: boolean;
    converter?: IAsnConverter;
    repeated?: AsnRepeatType;
}
export interface IAsnSchema {
    type: AsnTypeTypes;
    itemType: AsnPropTypes | IEmptyConstructor;
    items: {
        [key: string]: IAsnSchemaItem;
    };
    schema?: AsnSchemaType;
}
export type AsnSchemaType = asn1js.Sequence | asn1js.Set | asn1js.Choice;
export declare class AsnSchemaStorage {
    protected items: WeakMap<object, IAsnSchema>;
    has(target: object): boolean;
    get(target: IEmptyConstructor, checkSchema: true): IAsnSchema & Required<Pick<IAsnSchema, "schema">>;
    get(target: IEmptyConstructor, checkSchema?: false): IAsnSchema;
    cache(target: IEmptyConstructor): void;
    createDefault(target: object): IAsnSchema;
    create(target: object, useNames: boolean): AsnSchemaType;
    set(target: object, schema: IAsnSchema): this;
    protected findParentSchema(target: object): IAsnSchema | null;
}
