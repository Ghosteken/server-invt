/**
 * Tests for error sanitization
 * Verifies that technical errors are never exposed to clients
 */

import { sanitizeError, createErrorResponse } from '../utils/errorHandler';

describe('Error Handler', () => {
  describe('sanitizeError', () => {
    test('should sanitize Prisma P2002 (unique constraint) errors', () => {
      const prismaError = {
        code: 'P2002',
        meta: { target: ['email'] },
        message: 'Unique constraint failed on the fields: (`email`)',
        name: 'PrismaClientKnownRequestError',
      };

      const result = sanitizeError(prismaError);
      
      // Should NOT contain technical details
      expect(result).not.toContain('Prisma');
      expect(result).not.toContain('constraint');
      expect(result).not.toContain('fields');
      
      // Should be user-friendly
      expect(result).toContain('already exists');
    });

    test('should sanitize Prisma P2025 (record not found) errors', () => {
      const prismaError = {
        code: 'P2025',
        message: 'An operation failed because it depends on one or more records that were required but not found. Record to delete does not exist.',
        name: 'PrismaClientKnownRequestError',
      };

      const result = sanitizeError(prismaError);
      
      expect(result).not.toContain('operation failed');
      expect(result).not.toContain('depends on');
      expect(result).toContain("doesn't exist");
    });

    test('should sanitize Prisma P2003 (foreign key) errors', () => {
      const prismaError = {
        code: 'P2003',
        message: 'Foreign key constraint failed on the field: `customerId`',
        name: 'PrismaClientKnownRequestError',
      };

      const result = sanitizeError(prismaError);
      
      expect(result).not.toContain('Foreign key');
      expect(result).not.toContain('customerId');
      expect(result).not.toContain('field');
      expect(result).toMatch(/related|cannot|failed/i);
    });

    test('should provide context-specific messages for invoice operations', () => {
      const prismaError = {
        code: 'P2025',
        message: 'Record to delete does not exist.',
        name: 'PrismaClientKnownRequestError',
      };

      const result = sanitizeError(prismaError, 'invoice');
      
      expect(result).toContain('invoice');
      expect(result).not.toContain('Record');
    });

    test('should provide context-specific messages for product operations', () => {
      const prismaError = {
        code: 'P2002',
        meta: { target: ['name'] },
        message: 'Unique constraint failed',
        name: 'PrismaClientKnownRequestError',
      };

      const result = sanitizeError(prismaError, 'product');
      
      expect(result).toContain('product');
      expect(result).toContain('already exists');
    });

    test('should sanitize generic Error objects without exposing stack traces', () => {
      const error = new Error('Internal database connection error at line 123');

      const result = sanitizeError(error);
      
      expect(result).not.toContain('line 123');
      expect(result).not.toContain('database connection');
      expect(result).not.toContain('Internal');
    });

    test('should handle null/undefined errors gracefully', () => {
      expect(sanitizeError(null)).toBe('An error occurred while processing your request');
      expect(sanitizeError(undefined)).toBe('An error occurred while processing your request');
    });

    test('should use fallback message when provided', () => {
      const error = new Error('Some technical error');
      const fallback = 'Failed to process request';

      const result = sanitizeError(error, undefined, fallback);
      
      // Fallback should be used for generic errors when provided
      expect(result).toBe(fallback);
    });

    test('should never expose Prisma in error messages', () => {
      const testErrors = [
        { code: 'P2000', message: 'Prisma error' },
        { code: 'P2001', message: 'PrismaClient error' },
        { code: 'P2002', message: 'Prisma constraint failed' },
      ];

      testErrors.forEach(err => {
        const result = sanitizeError(err);
        expect(result.toLowerCase()).not.toContain('prisma');
      });
    });
  });

  describe('createErrorResponse', () => {
    test('should return properly formatted error response object', () => {
      const error = new Error('Test error');
      const response = createErrorResponse(error, undefined, 'Operation failed');

      expect(response).toHaveProperty('message');
      expect(typeof response.message).toBe('string');
      // When fallback is provided, it should be used
      expect(response.message).toBe('Operation failed');
    });

    test('should sanitize errors in response', () => {
      const prismaError = {
        code: 'P2002',
        message: 'Unique constraint violation',
        name: 'PrismaClientKnownRequestError',
      };

      const response = createErrorResponse(prismaError);

      expect(response.message).not.toContain('constraint');
      expect(response.message).not.toContain('violation');
      expect(response.message).toContain('already exists');
    });
  });
});

/**
 * Integration test helper
 * Use this to test actual API endpoints
 */
describe('Error Sanitization Integration', () => {
  test('example: simulating invoice deletion with Prisma error', () => {
    // This simulates what happens when trying to delete a non-existent invoice
    const prismaError = {
      code: 'P2025',
      message: 'An operation failed because it depends on one or more records that were required but not found. Record to delete does not exist.',
      name: 'PrismaClientKnownRequestError',
      clientVersion: '5.0.0',
    };

    const response = createErrorResponse(prismaError, 'invoice', 'Failed to delete invoice');

    // Verify client never sees technical details
    expect(response.message).not.toContain('operation failed');
    expect(response.message).not.toContain('depends on');
    expect(response.message).not.toContain('Record');
    expect(response.message).not.toContain('Prisma');
    
    // Should be user-friendly
    expect(response.message).toContain('invoice');
    expect(response.message).toMatch(/doesn't exist|no longer exists/i);

    console.log('✓ Invoice deletion error sanitized:', response.message);
  });

  test('example: simulating unique constraint violation', () => {
    const prismaError = {
      code: 'P2002',
      meta: {
        target: ['email'],
        field_name: 'User_email_key',
      },
      message: 'Unique constraint failed on the constraint: `User_email_key`',
      name: 'PrismaClientKnownRequestError',
    };

    const response = createErrorResponse(prismaError, 'customer', 'Failed to create customer');

    // Verify sanitization
    expect(response.message).not.toContain('constraint');
    expect(response.message).not.toContain('User_email_key');
    expect(response.message).not.toContain('Unique');
    
    // Should mention the duplicate
    expect(response.message).toContain('already exists');

    console.log('✓ Unique constraint error sanitized:', response.message);
  });

  test('example: simulating foreign key constraint error', () => {
    const prismaError = {
      code: 'P2003',
      meta: {
        field_name: 'customerId',
      },
      message: 'Foreign key constraint failed on the field: `customerId`',
      name: 'PrismaClientKnownRequestError',
    };

    const response = createErrorResponse(prismaError, 'invoice', 'Failed to delete invoice');

    // Verify sanitization
    expect(response.message).not.toContain('Foreign key');
    expect(response.message).not.toContain('customerId');
    expect(response.message).not.toContain('field');
    
    // Should indicate the constraint issue
    expect(response.message).toMatch(/related|constraint/i);

    console.log('✓ Foreign key error sanitized:', response.message);
  });
});
