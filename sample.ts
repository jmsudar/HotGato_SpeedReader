// Sample TypeScript script demonstrating pdf-parse usage
// Run with: npx ts-node sample.ts path/to/your.pdf
// Or: npm run dev sample.ts path/to/your.pdf

import * as fs from 'fs';
import * as path from 'path';

// Import pdf-parse - using dynamic import for better CommonJS compatibility
const { PDFParse } = require('pdf-parse');

// Interface for PDF data
interface PDFData {
  numpages: number;
  numrender: number;
  info: any;
  metadata: any;
  version: string;
  text: string;
}



// Main execution
async function main() {
  console.log('=== PDF Parse TypeScript Sample ===\n');

  // Get PDF path from command line arguments
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.log('Usage: ts-node sample.ts <path-to-pdf>');
    console.log('Example: ts-node sample.ts document.pdf');
    console.log('\nPlease provide a path to a PDF file to parse.');
    process.exit(0);
  }

  // Check if file exists
  if (!fs.existsSync(pdfPath)) {
    console.error(`Error: File not found: ${pdfPath}`);
    process.exit(1);
  }

  try {
    const parser = new PDFParse({ url: pdfPath });

    // const result = await parser.getInfo();
    // console.log(result.info);
    
    const text = await parser.getText({ partial: [3] });
    console.log(text.text);
  } catch (error) {
    console.error('Error parsing PDF:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
