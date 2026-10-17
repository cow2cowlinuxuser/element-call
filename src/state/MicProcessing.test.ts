/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, describe, expect, test } from "vitest";

import { micProcessing } from "../settings/settings";
import {
  defaultMicProcessing,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  getMicProcessing,
  type MicProcessing,
  micProcessingFrom,
  needsMicProcessing,
  observeMicProcessing,
  shouldProcessMic,
  updateMicProcessing,
  wantsBrowserNoiseSuppression,
} from "./MicProcessing";
import { EQ_RANGE_DB } from "./PeerAudio";

afterEach(() => micProcessing.setValue({}));

test("the microphone is left alone by default", () => {
  expect(getMicProcessing()).toEqual(defaultMicProcessing);
  expect(needsMicProcessing(getMicProcessing())).toBe(false);
});

test("changes are stored and clamped to their range", () => {
  updateMicProcessing({ gate: true, gateThreshold: -200, bass: 100 });
  expect(getMicProcessing()).toEqual({
    ...defaultMicProcessing,
    gate: true,
    gateThreshold: GATE_THRESHOLD_MIN_DB,
    bass: EQ_RANGE_DB,
  });

  updateMicProcessing({ gateThreshold: 5, treble: -100 });
  expect(getMicProcessing()).toMatchObject({
    gateThreshold: GATE_THRESHOLD_MAX_DB,
    treble: -EQ_RANGE_DB,
  });
});

test("settings back at default are forgotten", () => {
  updateMicProcessing({ noiseReduction: true });
  updateMicProcessing({ noiseReduction: false });
  expect(micProcessing.getValue()).toEqual({});
});

test("stored junk falls back to the default", () => {
  const stored = { noiseReduction: "yes", gate: 1, gateThreshold: "loud" };
  expect(
    micProcessingFrom(stored as unknown as Partial<MicProcessing>),
  ).toEqual(defaultMicProcessing);
});

test("observing emits only when the settings change", () => {
  const seen: MicProcessing[] = [];
  const subscription = observeMicProcessing().subscribe((m) => seen.push(m));
  micProcessing.setValue({ ...micProcessing.getValue() });
  updateMicProcessing({ mid: 3 });
  subscription.unsubscribe();

  expect(seen).toEqual([
    defaultMicProcessing,
    { ...defaultMicProcessing, mid: 3 },
  ]);
});

test.each<[string, Partial<MicProcessing>]>([
  ["noise reduction", { noiseReduction: true }],
  ["the gate", { gate: true }],
  ["bass", { bass: 2 }],
  ["mid", { mid: -2 }],
  ["treble", { treble: 1 }],
])("%s needs processing", (_name, changes) => {
  expect(needsMicProcessing({ ...defaultMicProcessing, ...changes })).toBe(
    true,
  );
});

test("a gate threshold alone does not need processing", () => {
  expect(
    needsMicProcessing({ ...defaultMicProcessing, gateThreshold: -30 }),
  ).toBe(false);
});

test("browser noise suppression gives way to noise reduction", () => {
  const withNoiseReduction = { ...defaultMicProcessing, noiseReduction: true };
  expect(wantsBrowserNoiseSuppression(true, defaultMicProcessing)).toBe(true);
  expect(wantsBrowserNoiseSuppression(true, withNoiseReduction)).toBe(false);
  expect(wantsBrowserNoiseSuppression(false, defaultMicProcessing)).toBe(false);
});

describe("turned off", () => {
  const everything: MicProcessing = {
    enabled: false,
    noiseReduction: true,
    gate: true,
    gateThreshold: -30,
    bass: -5,
    mid: 2,
    treble: -6,
  };

  test("nothing touches the microphone, not even the level meter", () => {
    expect(needsMicProcessing(everything)).toBe(false);
    expect(shouldProcessMic(everything, false)).toBe(false);
    expect(shouldProcessMic(everything, true)).toBe(false);
  });

  test("the browser's noise suppression comes back", () => {
    expect(wantsBrowserNoiseSuppression(true, everything)).toBe(true);
  });

  test("the other settings are kept for turning it back on", () => {
    updateMicProcessing(everything);
    expect(getMicProcessing()).toEqual(everything);
    updateMicProcessing({ enabled: true });
    expect(needsMicProcessing(getMicProcessing())).toBe(true);
  });
});

test("the level meter needs the processor only while processing is on", () => {
  expect(shouldProcessMic(defaultMicProcessing, false)).toBe(false);
  expect(shouldProcessMic(defaultMicProcessing, true)).toBe(true);
});
