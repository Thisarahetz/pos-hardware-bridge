const fs = require('node:fs');
const path = require('node:path');

const fileA = path.join(__dirname, '..', 'src', 'main', 'printer', 'receipt-layout.ts');
const fileB = path.join(__dirname, '..', 'packages', 'sdk', 'src', 'layout.ts');

if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
  console.error(`Layout file missing: ${fileA} or ${fileB}`);
  process.exit(1);
}

const contentA = fs.readFileSync(fileA);
const contentB = fs.readFileSync(fileB);

if (!contentA.equals(contentB)) {
  console.error('❌ Receipt layout copies are out of sync!');
  console.error(`  ${fileA}`);
  console.error(`  ${fileB}`);
  console.error('Please ensure both files are identical.');
  process.exit(1);
}

console.log('✔ Receipt layout copies are synchronized.');
