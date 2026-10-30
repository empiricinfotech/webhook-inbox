import { Error as MongooseError } from "mongoose";
import { ApiError } from "../errors.js";
import { CaptureTokenError } from "../security/capture-token.js";

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

// Never carry driver, validation input or crypto causes across the service boundary.
export async function safeStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof CaptureTokenError) throw new ApiError("INTERNAL_ERROR");
    if (isDuplicateKey(error)) throw new ApiError("CONFLICT");
    if (error instanceof MongooseError.ValidationError || error instanceof MongooseError.StrictModeError) {
      throw new ApiError("INVALID_REQUEST");
    }
    throw new ApiError("STORAGE_UNAVAILABLE");
  }
}
