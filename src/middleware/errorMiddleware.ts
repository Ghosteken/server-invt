/**
 * Global error handler middleware
 * This catches any errors that weren't handled by individual route handlers
 * and ensures no technical details are exposed to the client
 */

import { Request, Response, NextFunction } from "express";
import { createErrorResponse, logError } from "../utils/errorHandler";

/**
 * Express error handling middleware
 * Must be added AFTER all routes in your Express app
 */
export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Log the error for server-side debugging
  logError(err, `${req.method} ${req.path}`);

  // Send sanitized error response
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json(createErrorResponse(
    err,
    undefined,
    "An unexpected error occurred"
  ));
}

/**
 * Async route handler wrapper
 * Wraps async route handlers to catch any rejected promises
 * and pass them to the error handling middleware
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
