"use strict";
/* eslint-disable */
/**
 * Script to update all error handlers in controllers to use sanitized error handling
 * This script finds and replaces all instances of direct error message exposure
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const controllersDir = path.join(__dirname, '../src/controllers');
// Map of controller file names to their context names
const contextMap = {
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
function updateErrorHandlers(filePath, context) {
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    let content = originalContent;
    // Check if errorHandler import already exists
    if (!content.includes('import { createErrorResponse }')) {
        // Find the last import statement and add our import after it
        const lastImportMatch = content.match(/import[^;]+;(?!\s*import)/);
        if (lastImportMatch) {
            const insertPos = lastImportMatch.index + lastImportMatch[0].length;
            content = content.slice(0, insertPos) + '\nimport { createErrorResponse } from "../utils/errorHandler";' + content.slice(insertPos);
        }
    }
    // Pattern 1: res.status(500).json({ message: "literal string" });
    const pattern1 = /(\} catch \((?:err|error)\) \{\s*\n\s*)res\.status\(500\)\.json\(\{\s*message:\s*["']([^"']+)["']\s*\}\);/g;
    content = content.replace(pattern1, (_match, catchBlock, message) => {
        const contextArg = context ? `"${context}", ` : '';
        return `${catchBlock}res.status(500).json(createErrorResponse(err, ${contextArg}"${message}"));`;
    });
    // Pattern 2: res.status(500).json({ message: msg });
    const pattern2 = /(\} catch \((?:err|error)\) \{\s*\n\s*)res\.status\(500\)\.json\(\{\s*message:\s*msg\s*\}\);/g;
    content = content.replace(pattern2, (_match, catchBlock) => {
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
