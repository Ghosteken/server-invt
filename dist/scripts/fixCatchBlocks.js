"use strict";
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
/* eslint-disable */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const controllersDir = path.join(__dirname, '..', 'src', 'controllers');
const processFile = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    let newContent = content;
    // Fix all catch blocks to use (err) consistently
    newContent = newContent.replace(/\} catch \(error\) \{/g, '} catch (err) {');
    // Fix createErrorResponse calls that use 'error' instead of 'err'
    newContent = newContent.replace(/createErrorResponse\(error,/g, 'createErrorResponse(err,');
    // Fix console.warn calls that use 'error' instead of 'err'
    newContent = newContent.replace(/console\.warn\((.*?), error\)/g, 'console.warn($1, err)');
    if (newContent !== content) {
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.log(`✓ Fixed: ${path.basename(filePath)}`);
        return true;
    }
    return false;
};
const files = fs.readdirSync(controllersDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => path.join(controllersDir, file));
console.log('Fixing catch blocks with (error) parameter...\n');
let updatedCount = 0;
for (const file of files) {
    if (processFile(file)) {
        updatedCount++;
    }
}
console.log(`\nTotal files updated: ${updatedCount}`);
