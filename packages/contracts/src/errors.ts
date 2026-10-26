import { z } from "zod";
import { requestIdSchema, type RequestId } from "./identifiers.js";

export const apiErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
  "ENDPOINT_DISABLED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED", "STORAGE_UNAVAILABLE", "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.output<typeof apiErrorCodeSchema>;

// Public messages are static. Never substitute a driver, validation or input message.
export const API_ERRORS = {
  INVALID_REQUEST: { status: 400, message: "Request input is invalid" },
  UNAUTHENTICATED: { status: 401, message: "Authentication is required" },
  FORBIDDEN: { status: 403, message: "This action is not permitted" },
  NOT_FOUND: { status: 404, message: "Resource not found" },
  CONFLICT: { status: 409, message: "The request conflicts with the current state" },
  ENDPOINT_DISABLED: { status: 410, message: "This endpoint is disabled" },
  PAYLOAD_TOO_LARGE: { status: 413, message: "Request body exceeds the configured limit" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Request content type is not supported" },
  RATE_LIMITED: { status: 429, message: "Too many requests" },
  STORAGE_UNAVAILABLE: { status: 503, message: "Storage is temporarily unavailable" },
  INTERNAL_ERROR: { status: 500, message: "An unexpected error occurred" },
} as const satisfies Record<ApiErrorCode, { status: number; message: string }>;

export const apiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(200),
    requestId: requestIdSchema,
  }),
});
export type ApiErrorResponse = z.output<typeof apiErrorResponseSchema>;

export function createErrorResponse(code: ApiErrorCode, requestId: RequestId): ApiErrorResponse {
  return { error: { code, message: API_ERRORS[code].message, requestId } };
}
