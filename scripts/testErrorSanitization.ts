/* eslint-disable */
/**
 * Manual test script to verify error sanitization
 * Run this to see how different errors are transformed
 */

import { sanitizeError, createErrorResponse } from '../src/utils/errorHandler';

console.log('='.repeat(70));
console.log('ERROR SANITIZATION TEST');
console.log('='.repeat(70));

// Test 1: Prisma unique constraint error (P2002)
console.log('\n1. Testing Prisma P2002 (Unique Constraint) - Customer email duplicate');
console.log('-'.repeat(70));
const p2002Error = {
  code: 'P2002',
  meta: { target: ['email'] },
  message: 'Unique constraint failed on the constraint: `User_email_key`',
  name: 'PrismaClientKnownRequestError',
  clientVersion: '5.0.0',
};
const p2002Result = createErrorResponse(p2002Error, 'customer');
console.log('Raw Prisma Error:', JSON.stringify(p2002Error, null, 2));
console.log('Sanitized Response:', JSON.stringify(p2002Result, null, 2));
console.log('✓ Technical details hidden:', !p2002Result.message.includes('constraint'));

// Test 2: Prisma record not found (P2025)
console.log('\n2. Testing Prisma P2025 (Record Not Found) - Invoice deletion');
console.log('-'.repeat(70));
const p2025Error = {
  code: 'P2025',
  message: 'An operation failed because it depends on one or more records that were required but not found. Record to delete does not exist.',
  name: 'PrismaClientKnownRequestError',
};
const p2025Result = createErrorResponse(p2025Error, 'invoice', 'Failed to delete invoice');
console.log('Raw Prisma Error:', p2025Error.message);
console.log('Sanitized Response:', JSON.stringify(p2025Result, null, 2));
console.log('✓ User-friendly message:', p2025Result.message.includes('invoice'));

// Test 3: Prisma foreign key constraint (P2003)
console.log('\n3. Testing Prisma P2003 (Foreign Key Constraint) - Delete with dependencies');
console.log('-'.repeat(70));
const p2003Error = {
  code: 'P2003',
  meta: { field_name: 'customerId' },
  message: 'Foreign key constraint failed on the field: `customerId`',
  name: 'PrismaClientKnownRequestError',
};
const p2003Result = createErrorResponse(p2003Error, 'customer');
console.log('Raw Prisma Error:', p2003Error.message);
console.log('Sanitized Response:', JSON.stringify(p2003Result, null, 2));
console.log('✓ No database internals exposed:', !p2003Result.message.includes('Foreign key'));

// Test 4: Generic JavaScript Error
console.log('\n4. Testing Generic Error with Stack Trace');
console.log('-'.repeat(70));
const genericError = new Error('Database connection failed at connection.ts:123');
const genericResult = createErrorResponse(genericError, 'product', 'Failed to load products');
console.log('Raw Error:', genericError.message);
console.log('Sanitized Response:', JSON.stringify(genericResult, null, 2));
console.log('✓ Stack trace hidden:', !genericResult.message.includes(':123'));

// Test 5: Null/Undefined errors
console.log('\n5. Testing Null/Undefined Error Handling');
console.log('-'.repeat(70));
const nullResult = createErrorResponse(null);
console.log('Null Error Result:', JSON.stringify(nullResult, null, 2));
console.log('✓ Safe fallback provided:', nullResult.message.length > 0);

// Test 6: Context-specific errors
console.log('\n6. Testing Context-Specific Error Messages');
console.log('-'.repeat(70));
const contextError = { code: 'P2025', name: 'PrismaClientKnownRequestError' };

const invoiceContext = sanitizeError(contextError, 'invoice');
const productContext = sanitizeError(contextError, 'product');
const customerContext = sanitizeError(contextError, 'customer');

console.log('Invoice context:', invoiceContext);
console.log('Product context:', productContext);
console.log('Customer context:', customerContext);
console.log('✓ Context-aware messages:', invoiceContext.includes('invoice'));

// Summary
console.log('\n' + '='.repeat(70));
console.log('TEST SUMMARY');
console.log('='.repeat(70));

const allTests = [
  { name: 'P2002 sanitization', pass: !p2002Result.message.includes('constraint') },
  { name: 'P2025 sanitization', pass: !p2025Result.message.includes('operation failed') },
  { name: 'P2003 sanitization', pass: !p2003Result.message.includes('Foreign key') },
  { name: 'Generic error sanitization', pass: !genericResult.message.includes(':123') },
  { name: 'Null error handling', pass: nullResult.message.length > 0 },
  { name: 'Context-aware messages', pass: invoiceContext.includes('invoice') },
];

allTests.forEach(test => {
  const status = test.pass ? '✓ PASS' : '✗ FAIL';
  console.log(`${status}: ${test.name}`);
});

const passedCount = allTests.filter(t => t.pass).length;
console.log(`\n${passedCount}/${allTests.length} tests passed`);

if (passedCount === allTests.length) {
  console.log('\n🎉 All error sanitization tests PASSED!');
  console.log('✓ Technical errors are properly hidden from clients');
  console.log('✓ User-friendly messages are displayed');
} else {
  console.log('\n⚠️  Some tests failed. Review the implementation.');
}

console.log('='.repeat(70));
