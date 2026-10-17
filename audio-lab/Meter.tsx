/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";

import { type Measurement, meterFill, SILENCE_DB } from "./meters";

interface Props {
  label: string;
  reading: Measurement & { heldDb: number; clips: number };
}

const format = (value: number): string =>
  value <= SILENCE_DB ? "–∞" : value.toFixed(1);

/** A level meter showing average level, peak and how often it clipped. */
export const Meter: FC<Props> = ({ label, reading }) => (
  <div className="meter">
    <span className="meter-label">{label}</span>
    <div
      className="meter-bar"
      role="meter"
      aria-label={`${label} level`}
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={Math.max(-60, Math.round(reading.peakDb))}
    >
      <div
        className="meter-rms"
        style={{ width: `${meterFill(reading.rmsDb) * 100}%` }}
      />
      <div
        className="meter-peak"
        style={{ width: `${meterFill(reading.peakDb) * 100}%` }}
      />
      <div
        className="meter-hold"
        style={{ left: `${meterFill(reading.heldDb) * 100}%` }}
      />
    </div>
    <span className="meter-values">
      RMS {format(reading.rmsDb)} · peak {format(reading.heldDb)} dBFS
    </span>
    <span
      className={reading.clips > 0 ? "meter-clips clipping" : "meter-clips"}
    >
      {reading.clips} clipped
    </span>
  </div>
);
