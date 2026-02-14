# ⚡ VXL View - Instant Industrial CT Viewer

Zero-install, browser-based 3D volume inspection for industrial CT data.

**Open. Inspect. Decide.**

TBD 
![Quick Demo](./assets/quick-demo.gif)

---

## Why?

Industrial CT software is powerful — but heavy.

Sometimes you just need to:

- Check what a volume contains  
- Verify the correct scan revision  
- Quickly inspect for obvious porosity or defects  
- Share a fast visual reference  

Without waiting for full inspection software to boot.

This viewer is built for that exact moment.

It is intentionally scoped as a **quick inspection tool**, not a full analysis suite.

---

## What It Is

A lightweight WebGL-based 3D volume renderer that runs entirely in the browser.

- No installation  
- No plugins  
- Works on laptops and tablets  
- Optimized for fast first render  
- Streaming enabled for large volumes

Built specifically for **industrial inspection workflows**.

---

## 🎬 30-Second Inspection Demo

TBP

Demo includes:

- Opening a volume  
- Smooth orbit interaction  
- Slice inspection mode  
- Stable real-time rendering  

---

## Features

- Fast WebGL volume ray marching  
- Intuitive 3D rotation  
- Slice inspection mode
- Simple measurement
- Automatic downscaling and streaming of large volumes
- Designed for subtle grayscale inspection  
- Runs on standard laptop GPUs  
- Fully in-browser execution  

This viewer prioritizes:

- Fast startup  
- Immediate usability  
- Minimal friction  

---

## Target Use Case

Designed for:

- NDT engineers  
- Industrial CT operators  
- Quality assurance workflows  
- Quick inspection before deep analysis  

It is not intended to replace full CT analysis platforms.

---

## Architecture

- WebGL-based volume ray marching

---

## Automated Load-Time Benchmark

You can benchmark load performance automatically by driving the viewer with Playwright and collecting the existing `[LoadTiming]` logs.

### 1. Install benchmark dependency

```bash
npm install --save-dev playwright
npx playwright install chromium
```

### 2. Run benchmark for one dataset

```bash
node tools/benchmark-load-times.mjs --runs 5 --warmup 1 --csv tools/load-timing-results.csv -- "D:/3D data/BGA/perfekt.raw" "D:/3D data/BGA/perfekt.raw.volumeinfo"
```

### 3. Run benchmark from manifest (multiple datasets)

```bash
node tools/benchmark-load-times.mjs --manifest tools/benchmark-manifest.example.json --runs 3 --warmup 1
```

Outputs:

- JSON summary: `tools/load-timing-results.json`
- Optional CSV (if `--csv` is provided)
