"use strict";
/* eslint-disable */
/**
 * Live API test to verify error sanitization in real requests
 * This simulates actual client requests to test error handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
const BASE_URL = process.env.API_URL || 'http://localhost:8000';
const results = [];
async function testEndpoint(name, method, endpoint, body, token) {
    console.log(`\n📋 Testing: ${name}`);
    console.log(`   ${method} ${endpoint}`);
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await response.json();
        // Check if error message contains technical details
        const message = data.message || '';
        const hasTechnicalDetails = message.toLowerCase().includes('prisma') ||
            message.toLowerCase().includes('constraint') ||
            message.toLowerCase().includes('foreign key') ||
            message.toLowerCase().includes('at line') ||
            message.toLowerCase().includes('stack trace') ||
            message.includes('Error:') ||
            message.includes('P2002') ||
            message.includes('P2003') ||
            message.includes('P2025');
        const passed = !hasTechnicalDetails && message.length > 0;
        results.push({
            test: name,
            passed,
            clientMessage: message,
            hasTechnicalDetails,
        });
        console.log(`   Status: ${response.status}`);
        console.log(`   Message: "${message}"`);
        console.log(`   ${passed ? '✓ PASS' : '✗ FAIL'}: Technical details ${hasTechnicalDetails ? 'EXPOSED' : 'HIDDEN'}`);
    }
    catch (error) {
        console.log(`   ⚠️  Network error: ${error}`);
        results.push({
            test: name,
            passed: false,
            clientMessage: 'Network error',
            hasTechnicalDetails: false,
        });
    }
}
async function runTests() {
    console.log('='.repeat(70));
    console.log('LIVE API ERROR SANITIZATION TEST');
    console.log('='.repeat(70));
    console.log(`Testing API at: ${BASE_URL}`);
    console.log('Note: Server must be running for these tests to work');
    console.log('='.repeat(70));
    // Test 1: Non-existent invoice deletion (P2025)
    await testEndpoint('Delete non-existent invoice', 'DELETE', '/api/v1/invoices/non-existent-id-12345', undefined, 'fake-token');
    // Test 2: Duplicate customer creation (P2002)
    await testEndpoint('Create duplicate customer', 'POST', '/api/v1/customers', {
        name: 'Test Customer',
        email: 'duplicate@test.com',
    }, 'fake-token');
    // Test 3: Invalid login credentials
    await testEndpoint('Login with invalid credentials', 'POST', '/api/v1/auth/login', {
        email: 'nonexistent@test.com',
        password: 'wrongpassword',
    });
    // Test 4: Access protected route without token
    await testEndpoint('Access protected route (no auth)', 'GET', '/api/v1/products');
    // Test 5: Invalid product update
    await testEndpoint('Update non-existent product', 'PUT', '/api/v1/products/invalid-product-id', { name: 'Updated Name' }, 'fake-token');
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(70));
    results.forEach((result, index) => {
        const status = result.passed ? '✓ PASS' : '✗ FAIL';
        console.log(`${index + 1}. ${status}: ${result.test}`);
        if (result.hasTechnicalDetails) {
            console.log(`   ⚠️  EXPOSED: "${result.clientMessage}"`);
        }
    });
    const passedCount = results.filter(r => r.passed).length;
    const exposedCount = results.filter(r => r.hasTechnicalDetails).length;
    console.log(`\n${passedCount}/${results.length} tests passed`);
    console.log(`${exposedCount} technical details exposed`);
    if (passedCount === results.length && exposedCount === 0) {
        console.log('\n🎉 All API errors are properly sanitized!');
        console.log('✓ No technical details exposed to clients');
    }
    else {
        console.log('\n⚠️  Some errors are exposing technical details');
        console.log('Review the failed tests above');
    }
    console.log('='.repeat(70));
}
// Run tests if server is available
runTests().catch(error => {
    console.error('Test suite failed:', error);
    console.log('\n💡 Make sure the server is running: npm run dev');
});
