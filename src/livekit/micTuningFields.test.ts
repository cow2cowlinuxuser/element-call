/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";
import { type TFunction } from "i18next";

import {
  formatTuning,
  getTuning,
  micTuningFields,
  setTuning,
  type TuningField,
} from "./micTuningFields";
import { defaultMicTuning } from "./MicProcessor";
import { i18n } from "../utils/i18n";

const t = i18n.t.bind(i18n) as TFunction;

function field(path: string): TuningField {
  return micTuningFields.find((f) => f.path.join(".") === path)!;
}

test("every default lies within its control's range", () => {
  for (const f of micTuningFields) {
    const value = getTuning(defaultMicTuning, f.path);
    expect(value).toBeGreaterThanOrEqual(f.min);
    expect(value).toBeLessThanOrEqual(f.max);
  }
});

test("reads and changes values by their path", () => {
  expect(getTuning(defaultMicTuning, ["rumbleCutoffHz"])).toBe(
    defaultMicTuning.rumbleCutoffHz,
  );
  const changed = setTuning(defaultMicTuning, ["gate", "holdSeconds"], 0.7);
  expect(changed.gate).toEqual({ ...defaultMicTuning.gate, holdSeconds: 0.7 });
  expect(changed.limiter).toBe(defaultMicTuning.limiter);
  expect(setTuning(defaultMicTuning, ["rumbleCutoffHz"], 90)).toMatchObject({
    rumbleCutoffHz: 90,
  });
});

test("shows each value in its unit", () => {
  expect(formatTuning(t, field("rumbleCutoffHz"), 159)).toBe("159 Hz");
  expect(formatTuning(t, field("equaliser.midHz"), 2390)).toBe("2.39 kHz");
  expect(formatTuning(t, field("limiter.thresholdDb"), -6)).toBe("-6 dB");
  expect(formatTuning(t, field("gate.releaseSeconds"), 0.36)).toBe("360 ms");
  expect(formatTuning(t, field("limiter.ratio"), 20)).toBe("20:1");
  expect(formatTuning(t, field("equaliser.midQ"), 1.35)).toBe("1.35");
  expect(
    formatTuning(t, field("noiseReduction.delaySeconds"), 2054 / 48000),
  ).toBe("42.79 ms (2054 samples)");
});

test("names the extremes of the floors", () => {
  expect(formatTuning(t, field("noiseReduction.floorDb"), -100)).toBe("Full");
  expect(formatTuning(t, field("noiseReduction.floorDb"), -13)).toBe("-13 dB");
  expect(formatTuning(t, field("gate.floorDb"), -100)).toBe("Silent");
});
