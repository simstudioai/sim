"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsnParser = void 0;
const asn1js = require("asn1js");
const enums_1 = require("./enums");
const converters = require("./converters");
const errors_1 = require("./errors");
const helper_1 = require("./helper");
const storage_1 = require("./storage");
class AsnParser {
    static parse(data, target) {
        const asn1Parsed = asn1js.fromBER(data);
        if (asn1Parsed.result.error) {
            throw new Error(asn1Parsed.result.error);
        }
        const res = this.fromASN(asn1Parsed.result, target);
        return res;
    }
    static fromASN(asn1Schema, target) {
        var _a;
        try {
            if ((0, helper_1.isConvertible)(target)) {
                const value = new target();
                return value.fromASN(asn1Schema);
            }
            const schema = storage_1.schemaStorage.get(target);
            storage_1.schemaStorage.cache(target);
            let targetSchema = schema.schema;
            if (asn1Schema.constructor === asn1js.Constructed && schema.type !== enums_1.AsnTypeTypes.Choice) {
                targetSchema = new asn1js.Constructed({
                    idBlock: {
                        tagClass: 3,
                        tagNumber: asn1Schema.idBlock.tagNumber,
                    },
                    value: schema.schema.valueBlock.value,
                });
                for (const key in schema.items) {
                    delete asn1Schema[key];
                }
            }
            const asn1ComparedSchema = asn1js.compareSchema({}, asn1Schema, targetSchema);
            if (!asn1ComparedSchema.verified) {
                throw new errors_1.AsnSchemaValidationError(`Data does not match to ${target.name} ASN1 schema. ${asn1ComparedSchema.result.error}`);
            }
            const res = new target();
            if ((0, helper_1.isTypeOfArray)(target)) {
                if (!("value" in asn1Schema.valueBlock && Array.isArray(asn1Schema.valueBlock.value))) {
                    throw new Error(`Cannot get items from the ASN.1 parsed value. ASN.1 object is not constructed.`);
                }
                const itemType = schema.itemType;
                if (typeof itemType === "number") {
                    const converter = converters.defaultConverter(itemType);
                    if (!converter) {
                        throw new Error(`Cannot get default converter for array item of ${target.name} ASN1 schema`);
                    }
                    return target.from(asn1Schema.valueBlock.value, (element) => converter.fromASN(element));
                }
                else {
                    return target.from(asn1Schema.valueBlock.value, (element) => this.fromASN(element, itemType));
                }
            }
            for (const key in schema.items) {
                const asn1SchemaValue = asn1ComparedSchema.result[key];
                if (!asn1SchemaValue) {
                    continue;
                }
                const schemaItem = schema.items[key];
                const schemaItemType = schemaItem.type;
                if (typeof schemaItemType === "number" || (0, helper_1.isConvertible)(schemaItemType)) {
                    const converter = (_a = schemaItem.converter) !== null && _a !== void 0 ? _a : ((0, helper_1.isConvertible)(schemaItemType)
                        ? new schemaItemType()
                        : null);
                    if (!converter) {
                        throw new Error("Converter is empty");
                    }
                    if (schemaItem.repeated) {
                        if (schemaItem.implicit) {
                            const Container = schemaItem.repeated === "sequence" ? asn1js.Sequence : asn1js.Set;
                            const newItem = new Container();
                            newItem.valueBlock = asn1SchemaValue.valueBlock;
                            const newItemAsn = asn1js.fromBER(newItem.toBER(false));
                            if (newItemAsn.offset === -1) {
                                throw new Error(`Cannot parse the child item. ${newItemAsn.result.error}`);
                            }
                            if (!("value" in newItemAsn.result.valueBlock &&
                                Array.isArray(newItemAsn.result.valueBlock.value))) {
                                throw new Error("Cannot get items from the ASN.1 parsed value. ASN.1 object is not constructed.");
                            }
                            const value = newItemAsn.result.valueBlock.value;
                            res[key] = Array.from(value, (element) => converter.fromASN(element));
                        }
                        else {
                            res[key] = Array.from(asn1SchemaValue, (element) => converter.fromASN(element));
                        }
                    }
                    else {
                        let value = asn1SchemaValue;
                        if (schemaItem.implicit) {
                            let newItem;
                            if ((0, helper_1.isConvertible)(schemaItemType)) {
                                newItem = new schemaItemType().toSchema("");
                            }
                            else {
                                const Asn1TypeName = enums_1.AsnPropTypes[schemaItemType];
                                const Asn1Type = asn1js[Asn1TypeName];
                                if (!Asn1Type) {
                                    throw new Error(`Cannot get '${Asn1TypeName}' class from asn1js module`);
                                }
                                newItem = new Asn1Type();
                            }
                            newItem.valueBlock = value.valueBlock;
                            value = asn1js.fromBER(newItem.toBER(false)).result;
                        }
                        res[key] = converter.fromASN(value);
                    }
                }
                else {
                    if (schemaItem.repeated) {
                        if (!Array.isArray(asn1SchemaValue)) {
                            throw new Error("Cannot get list of items from the ASN.1 parsed value. ASN.1 value should be iterable.");
                        }
                        res[key] = Array.from(asn1SchemaValue, (element) => this.fromASN(element, schemaItemType));
                    }
                    else {
                        res[key] = this.fromASN(asn1SchemaValue, schemaItemType);
                    }
                }
            }
            return res;
        }
        catch (error) {
            if (error instanceof errors_1.AsnSchemaValidationError) {
                error.schemas.push(target.name);
            }
            throw error;
        }
    }
}
exports.AsnParser = AsnParser;
