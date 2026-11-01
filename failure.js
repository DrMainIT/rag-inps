import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { mkdir, writeFile } from "fs/promises";

const DOWNLOAD_CONCURRENCY = 10;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const docsDir = "./data/pdfs";
const failuresPath = "./download_failures.json";

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

          const redirectedUrl = new URL(
            response.headers.location,
            url,
          ).href;

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

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;

        if (index >= items.length) {
          break;
        }

        await worker(items[index], index);
      }
    },
  );

  await Promise.all(workers);
}

/*
 * Legge i fallimenti precedenti.
 */
if (!fs.existsSync(failuresPath)) {
  console.error(`File non trovato: ${failuresPath}`);
  process.exit(1);
}

const failuresData = JSON.parse(
  fs.readFileSync(failuresPath, "utf8"),
);

/*
 * Prendiamo esclusivamente i fallimenti relativi
 * a PDF effettivi.
 *
 * Esempio:
 * {
 *   "sourceUrl": "...",
 *   "pdfUrl": "...pdf",
 *   "error": "..."
 * }
 */
const pdfFailures = failuresData.filter(
  (failure) => failure.sourceUrl && failure.pdfUrl,
);

/*
 * Eventuali fallimenti di navigazione pagina vengono
 * conservati ma NON ritentati.
 *
 * Esempio:
 * {
 *   "sourceUrl": "...",
 *   "index": 12345,
 *   "error": "Navigation timeout"
 * }
 */
const nonPdfFailures = failuresData.filter(
  (failure) => !failure.pdfUrl,
);

/*
 * Elimina eventuali duplicati.
 */
const uniqueFailures = [
  ...new Map(
    pdfFailures.map((failure) => [
      `${failure.sourceUrl}|${failure.pdfUrl}`,
      failure,
    ]),
  ).values(),
];

console.log(`Fallimenti totali: ${failuresData.length}`);
console.log(`PDF da ritentare: ${uniqueFailures.length}`);
console.log(
  `Fallimenti pagina ignorati: ${nonPdfFailures.length}`,
);

const remainingFailures = [...nonPdfFailures];

let completed = 0;
let succeeded = 0;
let failed = 0;

await runWithConcurrency(
  uniqueFailures,
  DOWNLOAD_CONCURRENCY,
  async (failure) => {
    const { sourceUrl, pdfUrl } = failure;

    const folderName = sanitizeFolderName(sourceUrl);
    const urlFolder = path.join(docsDir, folderName);

    await mkdir(urlFolder, { recursive: true });

    let filename;

    try {
      const parsedUrl = new URL(pdfUrl);

      filename =
        path.basename(parsedUrl.pathname) ||
        `document_${Date.now()}.pdf`;
    } catch {
      filename = `document_${Date.now()}.pdf`;
    }

    const filepath = path.join(urlFolder, filename);

    /*
     * Se nel frattempo il file esiste ed è valido,
     * consideriamolo già risolto.
     */
    if (
      fs.existsSync(filepath) &&
      fs.statSync(filepath).size > 0
    ) {
      console.log(`[skip] ${filename}`);

      succeeded++;
      completed++;

      console.log(
        `[progress] ${completed}/${uniqueFailures.length} | OK: ${succeeded} | FAILED: ${failed}`,
      );

      return;
    }

    try {
      console.log(`[retry] ${pdfUrl}`);

      await downloadFile(pdfUrl, filepath);

      console.log(`[done] ${filename}`);

      succeeded++;
    } catch (error) {
      console.error(
        `[failed] ${pdfUrl}: ${error.message}`,
      );

      failed++;

      /*
       * Manteniamo solo il nuovo errore.
       */
      remainingFailures.push({
        sourceUrl,
        pdfUrl,
        error: error.message,
      });
    }

    completed++;

    console.log(
      `[progress] ${completed}/${uniqueFailures.length} | OK: ${succeeded} | FAILED: ${failed}`,
    );
  },
);

/*
 * Sovrascrive il file lasciando solamente
 * ciò che continua a fallire.
 */
await writeFile(
  failuresPath,
  JSON.stringify(remainingFailures, null, 2),
);

console.log("");
console.log("Finished.");
console.log(`Ritentati: ${uniqueFailures.length}`);
console.log(`Risolti: ${succeeded}`);
console.log(`Ancora falliti: ${failed}`);
console.log(
  `Fallimenti pagina non ritentati: ${nonPdfFailures.length}`,
);
console.log(`Failures aggiornati in: ${failuresPath}`);