"use strict";
/**
 * Global error handler middleware
 * This catches any errors that weren't handled by individual route handlers
 * and ensures no technical details are exposed to the client
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalErrorHandler = globalErrorHandler;
exports.asyncHandler = asyncHandler;
const errorHandler_1 = require("../utils/errorHandler");
/**
 * Express error handling middleware
 * Must be added AFTER all routes in your Express app
 */
function globalErrorHandler(err, req, res, next) {
    // If response already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(err);
    }
    // Log the error for server-side debugging
    (0, errorHandler_1.logError)(err, `${req.method} ${req.path}`);
    // Send sanitized error response
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json((0, errorHandler_1.createErrorResponse)(err, undefined, "An unexpected error occurred"));
}
/**
 * Async route handler wrapper
 * Wraps async route handlers to catch any rejected promises
 * and pass them to the error handling middleware
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
