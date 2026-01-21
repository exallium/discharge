/**
 * Error type utilities for type-safe error handling
 */

/**
 * Extended error from child_process exec operations
 */
export interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: string | null;
  killed?: boolean;
  cmd?: string;
}

/**
 * Type guard to check if an error is an ExecError
 */
export function isExecError(error: unknown): error is ExecError {
  return error instanceof Error && ('stdout' in error || 'stderr' in error || 'code' in error);
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

/**
 * Extract error stack from unknown error
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

/**
 * Normalize unknown error to Error instance
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  return new Error(String(error));
}
