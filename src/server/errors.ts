/**
 * Domain errors thrown by services. Server actions convert them into `{ ok: false, error }`
 * (see src/server/action-result.ts); messages are written to be shown to the user as-is.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "UNAUTHENTICATED",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(message, "FORBIDDEN");
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Your session has ended. Sign in again.") {
    super(message, "UNAUTHENTICATED");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "That record no longer exists.") {
    super(message, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message, "VALIDATION", fieldErrors);
  }
}

/** Someone else changed the record first (e.g. an IMEI sold a moment ago). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}
