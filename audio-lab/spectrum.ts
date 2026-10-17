/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { frequencyPosition } from "./meters";

export const SPECTRUM_FLOOR_DB = -110;
export const SPECTRUM_CEILING_DB = -10;
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

export interface SpectrumTrace {
  /** Decibels per bin, as from AnalyserNode.getFloatFrequencyData. */
  data: Float32Array;
  colour: string;
}

/** Where a level sits on the spectrum's vertical axis, from 0 at the top. */
export function levelPosition(db: number): number {
  const clamped = Math.min(
    SPECTRUM_CEILING_DB,
    Math.max(SPECTRUM_FLOOR_DB, db),
  );
  return (
    (SPECTRUM_CEILING_DB - clamped) / (SPECTRUM_CEILING_DB - SPECTRUM_FLOOR_DB)
  );
}

export function drawSpectrum(
  canvas: HTMLCanvasElement,
  sampleRate: number,
  traces: SpectrumTrace[],
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  context.strokeStyle = "rgba(255, 255, 255, 0.1)";
  context.fillStyle = "rgba(255, 255, 255, 0.5)";
  context.font = "10px sans-serif";
  for (const hz of GRID_HZ) {
    const x = frequencyPosition(hz) * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    context.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x + 2, 10);
  }

  for (const { data, colour } of traces) {
    const binHz = sampleRate / 2 / data.length;
    context.strokeStyle = colour;
    context.beginPath();
    let started = false;
    for (let bin = 1; bin < data.length; bin++) {
      const x = frequencyPosition(bin * binHz) * width;
      const y = levelPosition(data[bin]) * height;
      if (started) context.lineTo(x, y);
      else context.moveTo(x, y);
      started = true;
    }
    context.stroke();
  }
}
