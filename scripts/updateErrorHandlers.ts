/* eslint-disable */
/**
 * Script to update all error handlers in controllers to use sanitized error handling
 * This script finds and replaces all instances of direct error message exposure
 */

import * as fs from 'fs';
import * as path from 'path';

const controllersDir = path.join(__dirname, '../src/controllers');

// Map of controller file names to their context names
const contextMap: Record<string, string> = {
  'productController.ts': 'product',
  'customerController.ts': 'customer',
  'expenseController.ts': 'expense',
  'purchasesController.ts': 'purchase',
  'salesAgentController.ts': 'salesAgent',
  'locationController.ts': 'location',
  'storesController.ts': 'store',
  'userController.ts': 'user',
  'dashboardController.ts': '',
  'reportController.ts': '',
  'notificationController.ts': '',
  'contactController.ts': '',
  'authController.ts': '',
  'superAdminController.ts': '',
  'storeSalesController.ts': 'store',
  'aiController.ts': '',
};

function updateErrorHandlers(filePath: string, context: string) {
  const originalContent = fs.readFileSync(filePath, 'utf-8');
  let content = originalContent;

  // Check if errorHandler import already exists
  if (!content.includes('import { createErrorResponse }')) {
    // Find the last import statement and add our import after it
    const lastImportMatch = content.match(/import[^;]+;(?!\s*import)/);
    if (lastImportMatch) {
      const insertPos = lastImportMatch.index! + lastImportMatch[0].length;
      content = content.slice(0, insertPos) + '\nimport { createErrorResponse } from "../utils/errorHandler";' + content.slice(insertPos);
    }
  }

  // Pattern 1: res.status(500).json({ message: "literal string" });
  const pattern1 = /(\} catch \((?:err|error)\) \{\s*\n\s*)res\.status\(500\)\.json\(\{\s*message:\s*["']([^"']+)["']\s*\}\);/g;
  content = content.replace(pattern1, (_match: string, catchBlock: string, message: string) => {
    const contextArg = context ? `"${context}", ` : '';
    return `${catchBlock}res.status(500).json(createErrorResponse(err, ${contextArg}"${message}"));`;
  });

  // Pattern 2: res.status(500).json({ message: msg });
  const pattern2 = /(\} catch \((?:err|error)\) \{\s*\n\s*)res\.status\(500\)\.json\(\{\s*message:\s*msg\s*\}\);/g;
  content = content.replace(pattern2, (_match: string, catchBlock: string) => {
    const contextArg = context ? `"${context}", ` : '';
    return `${catchBlock}res.status(500).json(createErrorResponse(err, ${contextArg}msg));`;
  });
  
  // Pattern 3: Fix catch blocks without error parameter
  content = content.replace(/\} catch \{\s*\n\s*res\.status\(500\)/g, '} catch (err) {\n    res.status(500)');
  
  // Only write if content actually changed
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Updated: ${path.basename(filePath)}`);
    return true;
  }
  
  return false;
}

function processControllers() {
  let updatedCount = 0;
  
  for (const [fileName, context] of Object.entries(contextMap)) {
    const filePath = path.join(controllersDir, fileName);
    if (fs.existsSync(filePath)) {
      if (updateErrorHandlers(filePath, context)) {
        updatedCount++;
      }
    }
  }

  console.log(`\nTotal files updated: ${updatedCount}`);
}

processControllers();
