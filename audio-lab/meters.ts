/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

export const SILENCE_DB = -120;
/** Samples at or above this are counted as clipped. */
export const CLIP_LEVEL = 0.999;

export interface Measurement {
  peakDb: number;
  rmsDb: number;
  /** How many samples reached full scale. */
  clipped: number;
}

export function toDb(amplitude: number): number {
  return amplitude > 0
    ? Math.max(SILENCE_DB, 20 * Math.log10(amplitude))
    : SILENCE_DB;
}

export function measure(samples: Float32Array): Measurement {
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (const sample of samples) {
    const size = Math.abs(sample);
    if (size > peak) peak = size;
    if (size >= CLIP_LEVEL) clipped++;
    sum += sample * sample;
  }
  return {
    peakDb: toDb(peak),
    rmsDb: samples.length ? toDb(Math.sqrt(sum / samples.length)) : SILENCE_DB,
    clipped,
  };
}

/** How full a meter bar is, from 0 at the floor to 1 at full scale. */
export function meterFill(db: number, floorDb = -60): number {
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}

/**
 * A peak reading that jumps up at once but falls back slowly, so that the eye
 * can catch it.
 */
export function holdPeak(
  heldDb: number,
  currentDb: number,
  elapsedSeconds: number,
  fallDbPerSecond = 20,
): number {
  return Math.max(currentDb, heldDb - fallDbPerSecond * elapsedSeconds);
}

export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 20000;

/** Where a frequency sits on a logarithmic axis, from 0 to 1. */
export function frequencyPosition(hz: number): number {
  const clamped = Math.min(SPECTRUM_MAX_HZ, Math.max(SPECTRUM_MIN_HZ, hz));
  return (
    Math.log(clamped / SPECTRUM_MIN_HZ) /
    Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ)
  );
}
