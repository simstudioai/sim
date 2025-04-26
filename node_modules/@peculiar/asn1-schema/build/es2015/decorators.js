import * as converters from "./converters";
import { AsnTypeTypes } from "./enums";
import { schemaStorage } from "./storage";
export const AsnType = (options) => (target) => {
    let schema;
    if (!schemaStorage.has(target)) {
        schema = schemaStorage.createDefault(target);
        schemaStorage.set(target, schema);
    }
    else {
        schema = schemaStorage.get(target);
    }
    Object.assign(schema, options);
};
export const AsnChoiceType = () => AsnType({ type: AsnTypeTypes.Choice });
export const AsnSetType = (options) => AsnType({ type: AsnTypeTypes.Set, ...options });
export const AsnSequenceType = (options) => AsnType({ type: AsnTypeTypes.Sequence, ...options });
export const AsnProp = (options) => (target, propertyKey) => {
    let schema;
    if (!schemaStorage.has(target.constructor)) {
        schema = schemaStorage.createDefault(target.constructor);
        schemaStorage.set(target.constructor, schema);
    }
    else {
        schema = schemaStorage.get(target.constructor);
    }
    const copyOptions = Object.assign({}, options);
    if (typeof copyOptions.type === "number" && !copyOptions.converter) {
        const defaultConverter = converters.defaultConverter(options.type);
        if (!defaultConverter) {
            throw new Error(`Cannot get default converter for property '${propertyKey}' of ${target.constructor.name}`);
        }
        copyOptions.converter = defaultConverter;
    }
    schema.items[propertyKey] = copyOptions;
};
