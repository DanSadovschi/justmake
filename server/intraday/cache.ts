/**
 * Simple file-based candle cache.
 * Stores/loads candle data to avoid refetching from Binance.
 * Files: ./data-cache/{symbol}-{interval}-{start}-{end}.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle } from './types.js';

const CACHE_DIR = join(process.cwd(), 'data-cache');

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(symbol: string, interval: string, startMs: number, endMs: number): string {
  return `${symbol}-${interval}-${startMs}-${endMs}.json`;
}

export function loadCachedCandles(
  symbol: string, interval: string, startMs: number, endMs: number,
): Candle[] | null {
  ensureDir();
  const file = join(CACHE_DIR, cacheKey(symbol, interval, startMs, endMs));
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf-8');
    const data = JSON.parse(raw) as Candle[];
    console.log(`[cache] Loaded ${data.length} candles from cache`);
    return data;
  } catch {
    return null;
  }
}

export function saveCachedCandles(
  symbol: string, interval: string, startMs: number, endMs: number,
  candles: Candle[],
): void {
  ensureDir();
  const file = join(CACHE_DIR, cacheKey(symbol, interval, startMs, endMs));
  writeFileSync(file, JSON.stringify(candles));
  console.log(`[cache] Saved ${candles.length} candles to cache`);
}
