import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { API_ERRORS, createErrorResponse, type ApiErrorCode } from "@empiric-webhook-inbox/contracts/errors";
import { getRequestId, type RequestLogger } from "./request-context.js";

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode) {
    super(API_ERRORS[code].message);
    this.name = "ApiError";
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new ApiError("NOT_FOUND"));
};

export function errorHandler(logger?: RequestLogger): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      // Delegate connection termination without letting Express log a private error.
      next(new Error("Request failed after response started"));
      return;
    }
    const code = error instanceof ApiError ? error.code
      : error instanceof ZodError ? "INVALID_REQUEST" : "INTERNAL_ERROR";
    const requestId = getRequestId();
    if (code === "INTERNAL_ERROR") logger?.error({ requestId, code }, "Request failed");
    response.set("Cache-Control", "no-store").status(API_ERRORS[code].status)
      .json(createErrorResponse(code, requestId));
  };
}
