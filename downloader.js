import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { mkdir, writeFile } from "fs/promises";

const START_INDEX = 10296;
const END_INDEX = 14000; // exclusive: downloads indexes 1000 through 13999
const PAGE_CONCURRENCY = 16;
const DOWNLOAD_CONCURRENCY_PER_PAGE = 3;
const NAVIGATION_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const docsDir = "./data/pdfs";
const failuresPath = "./download_failures.json";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeFolderName(url) {
  return url
    .replace(/https?:\/\//, "")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 180);
}

function downloadFile(url, filepath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects"));
      return;
    }

    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          const redirectedUrl = new URL(response.headers.location, url).href;
          downloadFile(redirectedUrl, filepath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(filepath);
        response.pipe(file);

        file.on("finish", () => {
          file.close(resolve);
        });

        file.on("error", (error) => {
          fs.unlink(filepath, () => {});
          reject(error);
        });
      },
    );

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error("Download timeout"));
    });

    request.on("error", (error) => {
      fs.unlink(filepath, () => {});
      reject(error);
    });
  });
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });

  await Promise.all(workers);
}

async function downloadPdfLinks(sourceUrl, pdfLinks) {
  const folderName = sanitizeFolderName(sourceUrl);
  const urlFolder = path.join(docsDir, folderName);
  await mkdir(urlFolder, { recursive: true });

  const failures = [];

  await runWithConcurrency(
    pdfLinks,
    DOWNLOAD_CONCURRENCY_PER_PAGE,
    async (link, index) => {
      const parsedUrl = new URL(link);
      const filename = path.basename(parsedUrl.pathname) || `document_${index + 1}.pdf`;
      const filepath = path.join(urlFolder, filename);

      if (fs.existsSync(filepath) && fs.statSync(filepath).size > 0) {
        console.log(`  [skip] ${filename}`);
        return;
      }

      try {
        console.log(`  [download] ${filename}`);
        await downloadFile(link, filepath);
        console.log(`  [done] ${filename}`);
      } catch (error) {
        failures.push({ sourceUrl, pdfUrl: link, error: error.message });
        console.error(`  [failed] ${link}: ${error.message}`);
      }
    },
  );

  return failures;
}

async function processSourceUrl(page, sourceUrl, absoluteIndex) {
  console.log(`[${absoluteIndex}] Opening ${sourceUrl}`);

  await page.goto(sourceUrl, {
    waitUntil: "networkidle2",
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  const pdfLinks = await page.$$eval("a", (anchors) => [
    ...new Set(
      anchors
        .map((anchor) => anchor.href)
        .filter((href) => href && href.toLowerCase().includes(".pdf")),
    ),
  ]);

  console.log(`[${absoluteIndex}] Found ${pdfLinks.length} PDF(s)`);
  return downloadPdfLinks(sourceUrl, pdfLinks);
}

await mkdir(docsDir, { recursive: true });

const linksData = fs.readFileSync("./extracted_links.json", "utf8");
const extractedLinks = JSON.parse(linksData);
const linksToProcess = extractedLinks.slice(START_INDEX, END_INDEX);

console.log(
  `Processing ${linksToProcess.length} links from index ${START_INDEX} to ${
    END_INDEX - 1
  } with ${PAGE_CONCURRENCY} page worker(s).`,
);

const browser = await puppeteer.launch({
  headless: true,
  dumpio: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  enableExtensions: true,
  args: [
    "--disable-gpu",
    "--disable-dev-shm-usage",
  ],
});const failures = [];
let completed = 0;

try {
  await runWithConcurrency(
    linksToProcess,
    PAGE_CONCURRENCY,
    async (sourceUrl, relativeIndex) => {
      const absoluteIndex = START_INDEX + relativeIndex;
      const page = await browser.newPage();
      page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

      try {
        const urlFailures = await processSourceUrl(page, sourceUrl, absoluteIndex);
        failures.push(...urlFailures);
      } catch (error) {
        failures.push({ sourceUrl, index: absoluteIndex, error: error.message });
        console.error(`[${absoluteIndex}] Failed: ${error.message}`);
      } finally {
        completed += 1;
        console.log(
          `[progress] ${completed}/${linksToProcess.length} pages processed`,
        );
        await page.close();
        await delay(100);
      }
    },
  );
} finally {
  await browser.close();
}

await writeFile(failuresPath, JSON.stringify(failures, null, 2));

console.log(`Finished. Failures written to ${failuresPath}`);
console.log(`Total failures: ${failures.length}`);
