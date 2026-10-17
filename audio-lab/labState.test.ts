/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import {
  defaultLabState,
  labStateFrom,
  loadLabState,
  parseLabState,
  saveLabState,
} from "./labState";
import { defaultMicTuning } from "../src/livekit/MicProcessor";

test("starts from Element's defaults", () => {
  expect(labStateFrom(undefined)).toEqual(defaultLabState);
  expect(defaultLabState.tuning).toBe(defaultMicTuning);
});

test("keeps what was given and fills in the rest", () => {
  const state = labStateFrom({
    settings: { gate: true, bass: 4 },
    tuning: { limiter: { thresholdDb: -1 }, gate: { holdSeconds: 0.4 } },
    listener: { pan: -0.5 },
  });
  expect(state.settings).toMatchObject({ gate: true, bass: 4, mid: 0 });
  expect(state.tuning.limiter).toEqual({
    ...defaultMicTuning.limiter,
    thresholdDb: -1,
  });
  expect(state.tuning.gate.holdSeconds).toBe(0.4);
  expect(state.tuning.equaliser).toEqual(defaultMicTuning.equaliser);
  expect(state.listener).toMatchObject({ pan: -0.5, volume: 1 });
});

test("ignores values of the wrong type", () => {
  const state = labStateFrom({
    tuning: { rumbleCutoffHz: "loud", headroom: 1, limiter: null },
    settings: { bass: 99 },
  });
  expect(state.tuning.rumbleCutoffHz).toBe(defaultMicTuning.rumbleCutoffHz);
  expect(state.tuning.headroom).toBe(defaultMicTuning.headroom);
  expect(state.tuning.limiter).toEqual(defaultMicTuning.limiter);
  expect(state.settings.bass).toBe(24);
});

test("survives a save and load", () => {
  const storage = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } as unknown as Storage;
  const state = parseLabState(
    JSON.stringify({ settings: { noiseReduction: true } }),
  );

  saveLabState(fakeStorage, state);
  expect(loadLabState(fakeStorage)).toEqual(state);
});

test("falls back to the defaults when the saved state is broken", () => {
  const fakeStorage = { getItem: () => "{not json" } as unknown as Storage;
  expect(loadLabState(fakeStorage)).toEqual(defaultLabState);
});
