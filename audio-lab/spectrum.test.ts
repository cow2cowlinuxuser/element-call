/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test, vi } from "vitest";

import {
  drawSpectrum,
  levelPosition,
  SPECTRUM_CEILING_DB,
  SPECTRUM_FLOOR_DB,
} from "./spectrum";

test("places levels from the ceiling at the top to the floor at the bottom", () => {
  expect(levelPosition(SPECTRUM_CEILING_DB)).toBe(0);
  expect(levelPosition(SPECTRUM_FLOOR_DB)).toBe(1);
  expect(levelPosition(0)).toBe(0);
  expect(levelPosition(-Infinity)).toBe(1);
});

test("draws one line per trace", () => {
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
  };
  const canvas = {
    width: 100,
    height: 50,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;

  drawSpectrum(canvas, 48000, [
    { data: new Float32Array(4).fill(-60), colour: "grey" },
    { data: new Float32Array(4).fill(-30), colour: "green" },
  ]);

  expect(context.clearRect).toHaveBeenCalledWith(0, 0, 100, 50);
  // A grid line for each marked frequency, then a line for each trace
  const gridLines = context.fillText.mock.calls.length;
  expect(context.stroke).toHaveBeenCalledTimes(gridLines + 2);
});
