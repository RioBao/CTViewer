#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

function printUsage() {
    console.log(
        [
            'Usage:',
            '  node tools/benchmark-load-times.mjs [options] -- <file1> [file2 ...]',
            '  node tools/benchmark-load-times.mjs --manifest tools/benchmark-manifest.example.json',
            '',
            'Options:',
            '  --runs <n>           Number of measured runs (default: 5)',
            '  --warmup <n>         Warmup runs per dataset (default: 1)',
            '  --timeout-ms <n>     Per-run timeout in ms (default: 300000)',
            '  --out <path>         JSON result path (default: tools/load-timing-results.json)',
            '  --csv <path>         Optional CSV result path',
            '  --dataset <name>     Dataset name for positional files',
            '  --manifest <path>    JSON manifest with one or more datasets',
            '  --url <url>          Use existing viewer URL (skip local server)',
            '  --port <n>           Local server port when --url is not set (default: 4173)',
            '  --browser <name>     chromium|chrome|msedge (default: chrome)',
            '  --headed             Run browser with UI (default: headless)',
            '',
            'Manifest schema:',
            '  {',
            '    "datasets": [',
            '      { "name": "raw-small", "files": ["D:/data/a.raw", "D:/data/a.raw.volumeinfo"] },',
            '      { "name": "dicom-series", "folder": "D:/data/series1", "extensions": [".dcm", ".ima"] }',
            '    ]',
            '  }'
        ].join('\n')
    );
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseIntArg(flag, value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
    const options = {
        runs: 5,
        warmup: 1,
        timeoutMs: 300000,
        out: path.resolve(process.cwd(), 'tools/load-timing-results.json'),
        csv: null,
        datasetName: null,
        manifest: null,
        url: null,
        port: 4173,
        browser: 'chrome',
        headless: true
    };

    const positional = [];
    let passthroughFiles = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--') {
            passthroughFiles = true;
            continue;
        }

        if (passthroughFiles) {
            positional.push(arg);
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--runs') {
            options.runs = parseIntArg(arg, argv[++i], options.runs);
            continue;
        }
        if (arg === '--warmup') {
            options.warmup = parseIntArg(arg, argv[++i], options.warmup);
            continue;
        }
        if (arg === '--timeout-ms') {
            options.timeoutMs = parseIntArg(arg, argv[++i], options.timeoutMs);
            continue;
        }
        if (arg === '--out') {
            options.out = path.resolve(process.cwd(), argv[++i]);
            continue;
        }
        if (arg === '--csv') {
            options.csv = path.resolve(process.cwd(), argv[++i]);
            continue;
        }
        if (arg === '--dataset') {
            options.datasetName = argv[++i];
            continue;
        }
        if (arg === '--manifest') {
            options.manifest = path.resolve(process.cwd(), argv[++i]);
            continue;
        }
        if (arg === '--url') {
            options.url = argv[++i];
            continue;
        }
        if (arg === '--port') {
            options.port = parseIntArg(arg, argv[++i], options.port);
            continue;
        }
        if (arg === '--browser') {
            options.browser = String(argv[++i] || '').trim().toLowerCase() || options.browser;
            continue;
        }
        if (arg === '--headed') {
            options.headless = false;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new Error(`Unknown option: ${arg}`);
        }

        positional.push(arg);
    }

    options.positionalFiles = positional.map((p) => path.resolve(process.cwd(), p));
    return options;
}

function assertFilesExist(files) {
    for (const filePath of files) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            throw new Error(`Not a file: ${filePath}`);
        }
    }
}

function normalizeExtensions(input) {
    if (!input) return null;
    const values = Array.isArray(input) ? input : [input];
    const set = new Set();
    for (const raw of values) {
        const v = String(raw || '').trim().toLowerCase();
        if (!v) continue;
        set.add(v.startsWith('.') ? v : `.${v}`);
    }
    return set.size > 0 ? set : null;
}

function loadFilesFromFolder(folderPath, extensions = null) {
    const resolvedFolder = path.resolve(folderPath);
    if (!fs.existsSync(resolvedFolder)) {
        throw new Error(`Dataset folder not found: ${resolvedFolder}`);
    }
    const stat = fs.statSync(resolvedFolder);
    if (!stat.isDirectory()) {
        throw new Error(`Dataset folder is not a directory: ${resolvedFolder}`);
    }

    const extSet = normalizeExtensions(extensions);
    const files = fs
        .readdirSync(resolvedFolder, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(resolvedFolder, entry.name))
        .filter((filePath) => {
            if (!extSet) return true;
            const ext = path.extname(filePath).toLowerCase();
            return extSet.has(ext);
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (files.length === 0) {
        throw new Error(`No files found in dataset folder: ${resolvedFolder}`);
    }
    return files;
}

function loadDatasets(options) {
    if (options.manifest) {
        if (!fs.existsSync(options.manifest)) {
            throw new Error(`Manifest not found: ${options.manifest}`);
        }
        const raw = fs.readFileSync(options.manifest, 'utf8');
        const manifest = JSON.parse(raw);
        const datasets = Array.isArray(manifest.datasets) ? manifest.datasets : [];
        if (datasets.length === 0) {
            throw new Error('Manifest contains no datasets');
        }

        return datasets.map((entry, index) => {
            const name = String(entry.name || `dataset-${index + 1}`);
            let files = [];
            if (Array.isArray(entry.files) && entry.files.length > 0) {
                files = entry.files.map((p) => path.resolve(p));
            } else if (entry.folder) {
                files = loadFilesFromFolder(entry.folder, entry.extensions || null);
            } else {
                throw new Error(`Dataset "${name}" must define either "files" or "folder"`);
            }
            assertFilesExist(files);
            return { name, files };
        });
    }

    if (!options.positionalFiles || options.positionalFiles.length === 0) {
        throw new Error('No input files provided');
    }
    assertFilesExist(options.positionalFiles);
    const name = options.datasetName || path.basename(options.positionalFiles[0]);
    return [{ name, files: options.positionalFiles }];
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.html': return 'text/html; charset=utf-8';
        case '.js': return 'text/javascript; charset=utf-8';
        case '.css': return 'text/css; charset=utf-8';
        case '.json': return 'application/json; charset=utf-8';
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.gif': return 'image/gif';
        case '.svg': return 'image/svg+xml';
        case '.ico': return 'image/x-icon';
        default: return 'application/octet-stream';
    }
}

function createStaticServer(rootDir, port) {
    const normalizedRoot = path.resolve(rootDir);
    const server = http.createServer((req, res) => {
        try {
            const reqUrl = new URL(req.url || '/', 'http://localhost');
            const rawPath = decodeURIComponent(reqUrl.pathname);
            const requestPath = rawPath === '/' ? '/index.html' : rawPath;
            const safePath = requestPath.replace(/^\/+/, '');
            const filePath = path.resolve(normalizedRoot, safePath);

            if (!filePath.startsWith(normalizedRoot)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const contentType = getMimeType(filePath);
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
            fs.createReadStream(filePath).pipe(res);
        } catch (error) {
            res.writeHead(500);
            res.end(`Server error: ${error.message}`);
        }
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            resolve(server);
        });
    });
}

function parseLoadTimingLine(text) {
    const match = /^\[LoadTiming\]\[([^\]]+)\]\s+(Preview|Final)\s+ready for "([^"]+)" in ([0-9.]+)s(?: \((.*)\))?$/.exec(text);
    if (!match) return null;
    return {
        format: match[1],
        phase: match[2],
        name: match[3],
        seconds: parseFloat(match[4]),
        details: match[5] || ''
    };
}

function summarize(values) {
    const list = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (list.length === 0) {
        return null;
    }
    const sum = list.reduce((acc, v) => acc + v, 0);
    const mean = sum / list.length;
    const mid = Math.floor(list.length / 2);
    const median = list.length % 2 === 0
        ? (list[mid - 1] + list[mid]) / 2
        : list[mid];
    return {
        count: list.length,
        min: list[0],
        max: list[list.length - 1],
        mean,
        median
    };
}

function formatSeconds(value) {
    if (!Number.isFinite(value)) return '-';
    return `${value.toFixed(2)}s`;
}

function resolveLaunchOptions(browser) {
    if (browser === 'chrome') {
        return { channel: 'chrome' };
    }
    if (browser === 'msedge' || browser === 'edge') {
        return { channel: 'msedge' };
    }
    return {};
}

async function runSingleLoad(chromium, url, filePaths, timeoutMs, headless, browserName) {
    const launchOptions = {
        headless,
        ...resolveLaunchOptions(browserName)
    };
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleLines = [];
    const timingEvents = [];

    page.on('console', (msg) => {
        const text = msg.text();
        consoleLines.push(`[${msg.type()}] ${text}`);
        const parsed = parseLoadTimingLine(text);
        if (parsed) {
            timingEvents.push(parsed);
        }
    });

    page.on('pageerror', (error) => {
        consoleLines.push(`[pageerror] ${error.message}`);
    });

    page.on('dialog', async (dialog) => {
        consoleLines.push(`[dialog] ${dialog.message()}`);
        await dialog.dismiss();
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.setInputFiles('#fileInput', filePaths);

        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const finalEvent = timingEvents.find((e) => e.phase === 'Final');
            if (finalEvent) {
                const previewEvent = timingEvents.find((e) => e.phase === 'Preview') || null;
                return {
                    preview: previewEvent,
                    final: finalEvent,
                    logs: consoleLines
                };
            }
            await delay(100);
        }

        const previewEvent = timingEvents.find((e) => e.phase === 'Preview') || null;
        throw new Error(
            previewEvent
                ? `Timeout waiting for final load timing. Preview reached in ${previewEvent.seconds.toFixed(2)}s.`
                : 'Timeout waiting for load timing logs.'
        );
    } finally {
        await context.close();
        await browser.close();
    }
}

function toCsvRows(results) {
    const rows = [['dataset', 'run', 'format', 'name', 'preview_seconds', 'final_seconds', 'final_details']];
    for (const dataset of results.datasets) {
        for (const run of dataset.runs) {
            rows.push([
                dataset.name,
                String(run.run),
                run.format || '',
                run.name || '',
                Number.isFinite(run.previewSeconds) ? run.previewSeconds.toString() : '',
                Number.isFinite(run.finalSeconds) ? run.finalSeconds.toString() : '',
                run.details || ''
            ]);
        }
    }
    return rows
        .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
        .join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }

    const datasets = loadDatasets(options);

    let chromium = null;
    try {
        ({ chromium } = await import('playwright'));
    } catch (error) {
        console.error('Playwright is required but not installed.');
        console.error('Install with: npm install --save-dev playwright');
        console.error('Then install Chromium with: npx playwright install chromium');
        process.exitCode = 1;
        return;
    }

    let server = null;
    let url = options.url;
    if (!url) {
        server = await createStaticServer(process.cwd(), options.port);
        url = `http://127.0.0.1:${options.port}/index.html`;
        console.log(`Local server started at ${url}`);
    }

    const startedAt = new Date().toISOString();
    const runCountTotal = Math.max(1, options.warmup + options.runs);
    const output = {
        startedAt,
        viewerUrl: url,
        options: {
            runs: options.runs,
            warmup: options.warmup,
            timeoutMs: options.timeoutMs,
            browser: options.browser,
            headless: options.headless
        },
        datasets: []
    };

    try {
        for (const dataset of datasets) {
            console.log('');
            console.log(`Dataset: ${dataset.name} (${dataset.files.length} file(s))`);

            const datasetRuns = [];
            for (let i = 0; i < runCountTotal; i++) {
                const runIndex = i + 1;
                const isWarmup = i < options.warmup;
                const label = isWarmup ? `warmup ${runIndex}/${runCountTotal}` : `run ${runIndex - options.warmup}/${options.runs}`;
                process.stdout.write(`  ${label} ... `);

                const result = await runSingleLoad(
                    chromium,
                    url,
                    dataset.files,
                    options.timeoutMs,
                    options.headless,
                    options.browser
                );

                const previewSeconds = result.preview ? result.preview.seconds : null;
                const finalSeconds = result.final ? result.final.seconds : null;

                if (!isWarmup) {
                    datasetRuns.push({
                        run: runIndex - options.warmup,
                        format: result.final ? result.final.format : null,
                        name: result.final ? result.final.name : null,
                        previewSeconds,
                        finalSeconds,
                        details: result.final ? result.final.details : '',
                        logs: result.logs
                    });
                }

                console.log(`preview=${formatSeconds(previewSeconds)} final=${formatSeconds(finalSeconds)}`);
            }

            const summary = {
                previewSeconds: summarize(datasetRuns.map((r) => r.previewSeconds)),
                finalSeconds: summarize(datasetRuns.map((r) => r.finalSeconds))
            };

            output.datasets.push({
                name: dataset.name,
                fileCount: dataset.files.length,
                files: dataset.files,
                runs: datasetRuns,
                summary
            });

            const finalSummary = summary.finalSeconds;
            if (finalSummary) {
                console.log(
                    `  Final load summary: mean=${formatSeconds(finalSummary.mean)} ` +
                    `median=${formatSeconds(finalSummary.median)} ` +
                    `min=${formatSeconds(finalSummary.min)} max=${formatSeconds(finalSummary.max)}`
                );
            }
        }
    } finally {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
            console.log('');
            console.log('Local server stopped.');
        }
    }

    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(output, null, 2), 'utf8');
    console.log(`\nSaved JSON results to: ${options.out}`);

    if (options.csv) {
        fs.mkdirSync(path.dirname(options.csv), { recursive: true });
        fs.writeFileSync(options.csv, toCsvRows(output), 'utf8');
        console.log(`Saved CSV results to: ${options.csv}`);
    }
}

main().catch((error) => {
    console.error(`Benchmark failed: ${error.message}`);
    process.exitCode = 1;
});
