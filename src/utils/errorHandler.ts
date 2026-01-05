/**
 * Centralized error handling utilities to sanitize and format errors
 * for client-facing responses. Never expose technical details like
 * Prisma errors, database errors, or stack traces to the client.
 */

interface PrismaError extends Error {
  code?: string;
  meta?: {
    target?: string[];
    field_name?: string;
    model_name?: string;
    [key: string]: any;
  };
}

/**
 * Maps Prisma error codes to user-friendly messages
 */
const PRISMA_ERROR_MESSAGES: Record<string, string> = {
  P2000: "The provided value is too long for the field",
  P2001: "The record you're trying to access doesn't exist",
  P2002: "A record with this value already exists",
  P2003: "This operation failed due to a related record constraint",
  P2004: "A constraint failed on the database",
  P2005: "The value provided is invalid for this field",
  P2006: "The provided value is invalid",
  P2007: "Data validation error",
  P2008: "Failed to parse the query",
  P2009: "Failed to validate the query",
  P2010: "Raw query failed",
  P2011: "Null constraint violation",
  P2012: "Missing required value",
  P2013: "Missing required argument",
  P2014: "The change would violate a required relation",
  P2015: "A related record could not be found",
  P2016: "Query interpretation error",
  P2017: "The records are not connected",
  P2018: "The required connected records were not found",
  P2019: "Input error",
  P2020: "Value out of range",
  P2021: "The table does not exist",
  P2022: "The column does not exist",
  P2023: "Inconsistent column data",
  P2024: "Timed out fetching a new connection from the pool",
  P2025: "The record you're trying to access or modify doesn't exist",
  P2026: "The database provider doesn't support this feature",
  P2027: "Multiple errors occurred",
  P2028: "Transaction API error",
  P2030: "Cannot find fulltext index",
  P2033: "A number used is too large",
  P2034: "Transaction conflict occurred. Please try again",
};

/**
 * Common error contexts to provide better messages based on operation
 */
const ERROR_CONTEXTS: Record<string, Record<string, string>> = {
  invoice: {
    P2025: "The invoice you're trying to delete no longer exists",
    P2003: "Cannot delete this invoice because it has related records",
    default: "Failed to process invoice operation",
  },
  product: {
    P2002: "A product with this name already exists",
    P2025: "The product you're trying to access no longer exists",
    P2003: "Cannot delete this product because it's used in invoices or sales",
    default: "Failed to process product operation",
  },
  customer: {
    P2002: "A customer with this email or phone already exists",
    P2025: "The customer you're trying to access no longer exists",
    P2003: "Cannot delete this customer because they have related records",
    default: "Failed to process customer operation",
  },
  expense: {
    P2025: "The expense you're trying to access no longer exists",
    P2003: "Cannot delete this expense because it has related records",
    default: "Failed to process expense operation",
  },
  purchase: {
    P2025: "The purchase you're trying to access no longer exists",
    P2003: "Cannot delete this purchase because it has related records",
    default: "Failed to process purchase operation",
  },
  salesAgent: {
    P2002: "A sales agent with this name or email already exists",
    P2025: "The sales agent you're trying to access no longer exists",
    P2003: "Cannot delete this sales agent because they have related records",
    default: "Failed to process sales agent operation",
  },
  location: {
    P2002: "A location with this name already exists",
    P2025: "The location you're trying to access no longer exists",
    P2003: "Cannot delete this location because it has related records",
    default: "Failed to process location operation",
  },
  store: {
    P2002: "A store with this name already exists",
    P2025: "The store you're trying to access no longer exists",
    P2003: "Cannot delete this store because it has related records",
    default: "Failed to process store operation",
  },
  user: {
    P2002: "A user with this email already exists",
    P2025: "The user you're trying to access no longer exists",
    P2003: "Cannot delete this user because they have related records",
    default: "Failed to process user operation",
  },
};

/**
 * Check if error is a Prisma error
 */
function isPrismaError(error: any): error is PrismaError {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("P")
  );
}

/**
 * Sanitize error for client response
 * @param error The error object to sanitize
 * @param context Optional context (e.g., 'invoice', 'product') for better messages
 * @param fallbackMessage Default message if no specific message is found
 * @returns A user-friendly error message
 */
export function sanitizeError(
  error: unknown,
  context?: string,
  fallbackMessage: string = "An error occurred while processing your request"
): string {
  // Handle null/undefined
  if (!error) {
    return fallbackMessage;
  }

  // Handle Prisma errors
  if (isPrismaError(error)) {
    const prismaCode = error.code;

    // Check for context-specific message first
    if (context && ERROR_CONTEXTS[context] && prismaCode) {
      const contextMessages = ERROR_CONTEXTS[context];
      if (contextMessages[prismaCode]) {
        return contextMessages[prismaCode];
      }
      if (contextMessages.default) {
        return contextMessages.default;
      }
    }

    // Fall back to generic Prisma message
    if (prismaCode && PRISMA_ERROR_MESSAGES[prismaCode]) {
      return PRISMA_ERROR_MESSAGES[prismaCode];
    }

    // If we have meta info that might be helpful
    if (error.meta?.target) {
      const fields = Array.isArray(error.meta.target) ? error.meta.target.join(", ") : error.meta.target;
      if (prismaCode === "P2002") {
        return `A record with the same ${fields} already exists`;
      }
    }

    // Generic Prisma error
    return "A database error occurred. Please try again";
  }

  // Handle validation errors (Zod or similar)
  if (error instanceof Error && error.name === "ZodError") {
    return "Invalid input data provided";
  }

  // Handle standard Error objects (but don't expose the message directly)
  if (error instanceof Error) {
    // Only return the message if it looks user-friendly (no stack traces, no code)
    const message = error.message;
    if (
      message &&
      !message.includes("prisma") &&
      !message.includes("Prisma") &&
      !message.includes("at ") &&
      !message.includes("Error:") &&
      message.length < 200
    ) {
      return message;
    }
  }

  // Generic fallback
  return fallbackMessage;
}

/**
 * Log error details for debugging (server-side only)
 * @param error The error to log
 * @param context Additional context for the log
 */
export function logError(error: unknown, context?: string): void {
  const prefix = context ? `[${context}]` : "";
  
  if (error instanceof Error) {
    console.error(`${prefix} Error:`, error.message);
    if (error.stack) {
      console.error(`${prefix} Stack:`, error.stack);
    }
  } else {
    console.error(`${prefix} Error:`, error);
  }

  // Log Prisma-specific details if available
  if (isPrismaError(error)) {
    console.error(`${prefix} Prisma Code:`, error.code);
    if (error.meta) {
      console.error(`${prefix} Prisma Meta:`, JSON.stringify(error.meta, null, 2));
    }
  }
}

/**
 * Create a sanitized error response object
 * @param error The error to sanitize
 * @param context Optional context for better messages
 * @param fallbackMessage Default message
 * @returns Response object with sanitized message
 */
export function createErrorResponse(
  error: unknown,
  context?: string,
  fallbackMessage?: string
): { message: string } {
  logError(error, context);
  return {
    message: sanitizeError(error, context, fallbackMessage),
  };
}
