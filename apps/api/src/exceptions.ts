import { StatusMap } from "elysia";
import config from "./config";

export const Exceptions = {
    FORBIDDEN: "You are not allowed to perform this action",
    COMMON_ITEM_NOT_FOUND: "Item was not found",
    COMMON_ITEM_ALREADY_EXISTS: "Item already exists",
    COMMON_ITEM_INVALID: "Item is invalid",
    AUTH_GUARD_FAILED: "Authentication failed",
    AUTH_PROVIDER_NOT_FOUND: "The authentication provider was not found",
    AUTH_PROVIDER_FAILED: "Authenticating with the provider failed",
    USER_NOT_FOUND: "User was not found",
    USER_EXISTS: "User already exists",
    USER_IS_SOCIAL_ACCOUNT_PASSWORD: "Password is not accepted as the user created the account with a social provider",
    USER_INVALID_PASSWORD: "The provided password is invalid",
    USER_INVALID_PASSWORD_RESET_TOKEN: "The provided password reset token is invalid or has expired",
    INTERNAL_SERVER_ERROR: "An error occurred while processing your request",
    UNAUTHORIZED: "You are not authorized to perform this action",
    VALIDATION_ERROR: "Validation error",
    BLOCK_NOT_FOUND: 'BLOCK_NOT_FOUND'
};

export type ExceptionCodeType = keyof typeof Exceptions;
export type HTTPStatus = number | keyof StatusMap;
export type ExceptionType = {
    status: number;
    type: string;
    code?: ExceptionCodeType;
    message: string;
    [key: string]: any;
}

/**
 * A map of all the exception codes, allowing us to access them in a type-safe way by their properties and get the value back
 *
 * @example
 *
 * ```javascript
 * expect(body.code).toEqual(ExceptionsCodes.USER_INVALID_PASSWORD);
 * ```
 */
export const ExceptionCodes: Record<ExceptionCodeType, ExceptionCodeType> = Object.keys(Exceptions).reduce(
    (acc, key) => {
        const typedKey = key as ExceptionCodeType;
        acc[typedKey] = typedKey;
        return acc;
    },
    {} as Record<ExceptionCodeType, ExceptionCodeType>
);

export function getHTTPStatusByCode(code: number): HTTPStatus {
    const statusCode = Object.entries(StatusMap).find(([_, value]) => value === code);
    return statusCode ? (statusCode[0] as HTTPStatus) : "Internal Server Error";
}

export function exception(exceptionCode?: ExceptionCodeType, type: HTTPStatus = "Internal Server Error", data?: object): ExceptionType {
    const dataParsed = data ?? {};

    // If the type is a number, get the corresponding status code from the StatusMap.
    const typeParsed = typeof type === "number" ? Object.keys(StatusMap).find((key) => StatusMap[key as keyof StatusMap] === type) : type;

    // Convert type to lowercase and replace underscores with hyphens for the URL path.
    // e.g., BAD_REQUEST -> bad-request
    const typeSanitized = typeParsed?.toLocaleLowerCase().replace(/[_\s]/g, "-");

    return {
        ...dataParsed,
        status: StatusMap[typeParsed as keyof StatusMap] ?? StatusMap["Internal Server Error"],
        type: `${config().server.backendUrl ?? "https://example.com"}/error/${typeSanitized ?? "general"}`,
        code: exceptionCode,
        message: Exceptions[exceptionCode ?? "INTERNAL_SERVER_ERROR"],
    }
}
