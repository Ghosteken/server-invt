# Test Error Handling Implementation
Write-Host "Testing Error Sanitization..." -ForegroundColor Cyan

# Test 1: Test unit tests
Write-Host "`n=== Running Unit Tests ===" -ForegroundColor Yellow
Set-Location "c:\Users\ASUS\Desktop\saas1\server"
npx ts-node scripts/testErrorSanitization.ts

Write-Host "`nTo test with live API:" -ForegroundColor Green
Write-Host "1. Start the server: npm run dev" -ForegroundColor White
Write-Host "2. Try operations that should fail (e.g., delete non-existent invoice)" -ForegroundColor White
Write-Host "3. Check error messages - they should NOT contain:" -ForegroundColor White
Write-Host "   - 'Prisma'" -ForegroundColor Red
Write-Host "   - Database error codes (P2002, P2003, P2025, etc.)" -ForegroundColor Red
Write-Host "   - Table names or constraint names" -ForegroundColor Red
Write-Host "   - Stack traces" -ForegroundColor Red
Write-Host "`n4. They SHOULD contain:" -ForegroundColor White
Write-Host "   - User-friendly messages like 'Failed to delete invoice'" -ForegroundColor Green
Write-Host "   - Context-appropriate errors" -ForegroundColor Green
