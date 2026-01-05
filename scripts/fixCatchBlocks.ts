/* eslint-disable */
import * as fs from 'fs';
import * as path from 'path';

const controllersDir = path.join(__dirname, '..', 'src', 'controllers');

const processFile = (filePath: string): boolean => {
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
  .filter((file: string) => file.endsWith('.ts'))
  .map((file: string) => path.join(controllersDir, file));

console.log('Fixing catch blocks with (error) parameter...\n');

let updatedCount = 0;
for (const file of files) {
  if (processFile(file)) {
    updatedCount++;
  }
}

console.log(`\nTotal files updated: ${updatedCount}`);
