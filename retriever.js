import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import https from "https";
import { mkdir } from "fs/promises";
// Or import puppeteer from 'puppeteer-core';

// Launch the browser and open a new blank page.
const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();

// Navigate the page to a URL.
await page.goto(
  "https://www.inps.it/it/it/inps-comunica/atti/circolari-messaggi-e-normativa.html",
);

// Set the screen size.
await page.setViewport({ width: 1080, height: 1024 });

// Select 100 items in the dropdown
try {
  await page.waitForSelector("#input-number-items", { timeout: 5000 });
  await page.select("#input-number-items", "100");
  console.log("Selected 100 items in dropdown");
  
  // Wait for table to update after selection
  await new Promise(resolve => setTimeout(resolve, 2000));
} catch (err) {
  console.log("Select element not found or error selecting:", err.message);
}

// Extract links from all pages using jQuery click
let allExtractedLinks = [];
let pageNumber = 1;
let hasNextPage = true;

console.log("\n=== Starting Link Extraction Loop ===");

const tableSelector = "table";

while (hasNextPage && pageNumber <= 150) { // Safety limit
  console.log(`\nProcessing page ${pageNumber}...`);
  
  // Wait for table to be visible
  await page.waitForSelector(tableSelector, { timeout: 5000 });
  
  // Extract links from current page
  const pageLinks = await page.$$eval(`${tableSelector} a`, (anchorTags) => {
    return anchorTags.map((a) => a.href);
  });
  
  console.log(`Found ${pageLinks.length} links on page ${pageNumber}`);
  allExtractedLinks = [...allExtractedLinks, ...pageLinks];
  
  // Check if next button is available and clickable
  const nextButtonExists = await page.evaluate(() => {
    const btn = $('#list-paginatore-next');
    return btn.length > 0 && !btn.prop('disabled');
  });
  
  if (nextButtonExists) {
    console.log(`Clicking next button...`);
    
    // Click the next button using jQuery
    await page.evaluate(() => {
      $('#list-paginatore-next').click();
    });
    
    // Wait for the page to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    pageNumber++;
  } else {
    hasNextPage = false;
    console.log("No more pages available");
  }
}

console.log(`\n=== Extraction Complete ===`);
console.log(`Total pages processed: ${pageNumber}`);
console.log(`Total links extracted: ${allExtractedLinks.length}`);
console.log("Extracted Links:", allExtractedLinks);

// Save links to file
const linksFile = "extracted_links.json";
fs.writeFileSync(linksFile, JSON.stringify(allExtractedLinks, null, 2));
console.log(`Links saved to ${linksFile}`);

// Also save as text file with one link per line
const linksTextFile = "extracted_links.txt";
fs.writeFileSync(linksTextFile, allExtractedLinks.join("\n"));
console.log(`Links also saved to ${linksTextFile}`);

// Close the browser
await browser.close();
console.log("Browser closed");
