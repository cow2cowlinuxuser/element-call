/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test } from "vitest";

import {
  getMicTuning,
  micTuningFrom,
  observeMicTuning,
  updateMicTuning,
  voiceSettingsFrom,
  withDefaults,
} from "./MicTuning";
import { defaultMicProcessing } from "./MicProcessing";
import { defaultMicTuning, type MicTuning } from "../livekit/MicProcessor";
import { micTuning } from "../settings/settings";

afterEach(() => micTuning.setValue({}));

test("fills in missing values and ignores those of the wrong type", () => {
  expect(
    withDefaults({ a: 1, b: { c: true } }, { a: "x", b: { c: false } }),
  ).toEqual({ a: 1, b: { c: false } });
  expect(withDefaults({ a: 1 }, null)).toEqual({ a: 1 });
  expect(withDefaults({ a: 1 }, { a: NaN })).toEqual({ a: 1 });
});

test("reads tuning, keeping each value within its range", () => {
  const tuning = micTuningFrom({
    rumbleCutoffHz: 5000,
    gate: { floorDb: -500, holdSeconds: 0.5 },
  });
  expect(tuning.rumbleCutoffHz).toBe(300);
  expect(tuning.gate.floorDb).toBe(-100);
  expect(tuning.gate.holdSeconds).toBe(0.5);
  expect(tuning.limiter).toEqual(defaultMicTuning.limiter);
});

test("the defaults survive being read", () => {
  expect(micTuningFrom(undefined)).toEqual(defaultMicTuning);
});

test("stores nothing while the tuning is the default", () => {
  const changed: MicTuning = { ...defaultMicTuning, headroom: true };
  updateMicTuning(changed);
  expect(micTuning.getValue()).toEqual(changed);
  expect(getMicTuning()).toEqual(changed);

  updateMicTuning(defaultMicTuning);
  expect(micTuning.getValue()).toEqual({});
});

test("follows changes to the stored tuning", () => {
  const seen: MicTuning[] = [];
  const subscription = observeMicTuning().subscribe((t) => seen.push(t));
  updateMicTuning({ ...defaultMicTuning, rumbleCutoffHz: 100 });
  updateMicTuning({ ...defaultMicTuning, rumbleCutoffHz: 100 });
  subscription.unsubscribe();

  expect(seen.map((t) => t.rumbleCutoffHz)).toEqual([
    defaultMicTuning.rumbleCutoffHz,
    100,
  ]);
});

test("reads voice settings copied from the audio lab", () => {
  const { settings, tuning } = voiceSettingsFrom({
    settings: { gate: true, gateThreshold: -20, bass: 6 },
    tuning: { headroom: true },
    listener: { volume: 0.5 },
  });
  expect(settings).toEqual({
    ...defaultMicProcessing,
    gate: true,
    gateThreshold: -20,
    bass: 6,
  });
  expect(tuning).toEqual({ ...defaultMicTuning, headroom: true });
});

test("falls back to the defaults for settings that are not an object", () => {
  expect(voiceSettingsFrom("nonsense")).toEqual({
    settings: defaultMicProcessing,
    tuning: defaultMicTuning,
  });
});
