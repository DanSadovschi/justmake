import { describe, it, expect } from 'vitest';
import { configSchema } from '../server/intraday/configSchema.js';
import { DEFAULT_CONFIG } from '../server/intraday/config.js';

describe('Config Schema Validation', () => {
  it('accepts valid default config', () => {
    const result = configSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });

  it('rejects emaFast >= emaSlow', () => {
    const cfg = { ...DEFAULT_CONFIG, emaFast: 50, emaSlow: 20 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map(i => i.message);
      expect(msgs.some(m => m.includes('emaFast must be < emaSlow'))).toBe(true);
    }
  });

  it('rejects emaFast === emaSlow', () => {
    const cfg = { ...DEFAULT_CONFIG, emaFast: 50, emaSlow: 50 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects rsiMax > 90', () => {
    const cfg = { ...DEFAULT_CONFIG, rsiMax: 95 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects adxThreshold > 60', () => {
    const cfg = { ...DEFAULT_CONFIG, adxThreshold: 65 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects slAtrMultiple <= 0', () => {
    const cfg = { ...DEFAULT_CONFIG, slAtrMultiple: 0 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects trailAtrMultiple <= 0', () => {
    const cfg = { ...DEFAULT_CONFIG, trailAtrMultiple: -1 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects empty symbol', () => {
    const cfg = { ...DEFAULT_CONFIG, symbol: '' };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects invalid interval', () => {
    const cfg = { ...DEFAULT_CONFIG, interval: '2h' };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects lookbackDays <= 30', () => {
    const cfg = { ...DEFAULT_CONFIG, lookbackDays: 30 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('accepts lookbackDays = 31', () => {
    const cfg = { ...DEFAULT_CONFIG, lookbackDays: 31 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it('rejects scoring strategy with scoreThreshold > 5', () => {
    const cfg = { ...DEFAULT_CONFIG, strategy: 'scoring' as const, scoreThreshold: 6 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects scoring_simple with scoreThreshold > 3', () => {
    const cfg = { ...DEFAULT_CONFIG, strategy: 'scoring_simple' as const, scoreThreshold: 4 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('accepts scoring_simple with scoreThreshold = 3', () => {
    const cfg = { ...DEFAULT_CONFIG, strategy: 'scoring_simple' as const, scoreThreshold: 3 };
    const result = configSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
});
