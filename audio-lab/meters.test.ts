/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import {
  frequencyPosition,
  holdPeak,
  measure,
  meterFill,
  SILENCE_DB,
  toDb,
} from "./meters";

test("converts amplitudes to decibels, with a floor for silence", () => {
  expect(toDb(1)).toBe(0);
  expect(toDb(0.1)).toBeCloseTo(-20);
  expect(toDb(0)).toBe(SILENCE_DB);
});

test("measures the peak, average level and clipped samples", () => {
  const result = measure(new Float32Array([0.5, -1, 0.25, 1]));
  expect(result.peakDb).toBe(0);
  expect(result.rmsDb).toBeCloseTo(
    toDb(Math.sqrt((0.25 + 1 + 0.0625 + 1) / 4)),
  );
  expect(result.clipped).toBe(2);
});

test("treats an empty buffer as silence", () => {
  expect(measure(new Float32Array())).toEqual({
    peakDb: SILENCE_DB,
    rmsDb: SILENCE_DB,
    clipped: 0,
  });
});

test("fills a meter between its floor and full scale", () => {
  expect(meterFill(-60)).toBe(0);
  expect(meterFill(-30)).toBe(0.5);
  expect(meterFill(6)).toBe(1);
  expect(meterFill(-90)).toBe(0);
});

test("a held peak jumps up but falls back slowly", () => {
  expect(holdPeak(-20, -6, 0.1)).toBe(-6);
  expect(holdPeak(-6, -40, 0.5)).toBe(-16);
});

test("places frequencies on a logarithmic axis", () => {
  expect(frequencyPosition(20)).toBe(0);
  expect(frequencyPosition(20000)).toBe(1);
  expect(frequencyPosition(Math.sqrt(20 * 20000))).toBeCloseTo(0.5);
  expect(frequencyPosition(5)).toBe(0);
});
