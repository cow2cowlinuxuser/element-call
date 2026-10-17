/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type TFunction } from "i18next";

import { type MicTuning } from "./MicProcessor";

export type TuningPath =
  | ["rumbleCutoffHz"]
  | ["noiseReduction", keyof MicTuning["noiseReduction"]]
  | ["equaliser", keyof MicTuning["equaliser"]]
  | ["limiter", keyof MicTuning["limiter"]]
  | ["gate", keyof MicTuning["gate"]];

type Unit =
  | "hz"
  | "db"
  | "seconds"
  | "samples"
  | "ratio"
  | "q"
  /** Where the lowest value means nothing is mixed in. */
  | "noiseFloor"
  /** Where the lowest value means silence. */
  | "gateFloor";

export interface TuningField {
  path: TuningPath;
  label: (t: TFunction) => string;
  min: number;
  max: number;
  step: number;
  unit: Unit;
}

export interface TuningGroup {
  id: string;
  title: (t: TFunction) => string;
  description?: (t: TFunction) => string;
  fields: TuningField[];
}

const SAMPLE_RATE = 48000;

/**
 * The inner workings of the microphone processing that can be adjusted, as
 * shown both in Element Call and in the audio lab.
 */
export const micTuningGroups: TuningGroup[] = [
  {
    id: "noise_reduction",
    title: (t) => t("settings.mic_tuning.noise_reduction_title"),
    description: (t) => t("settings.mic_tuning.noise_reduction_description"),
    fields: [
      {
        path: ["noiseReduction", "floorDb"],
        label: (t) => t("settings.mic_tuning.noise_reduction_floor"),
        min: -100,
        max: 0,
        step: 1,
        unit: "noiseFloor",
      },
      {
        path: ["noiseReduction", "delaySeconds"],
        label: (t) => t("settings.mic_tuning.noise_reduction_delay"),
        min: 0,
        max: 0.05,
        step: 1 / SAMPLE_RATE,
        unit: "samples",
      },
    ],
  },
  {
    id: "equaliser",
    title: (t) => t("settings.mic_tuning.equaliser_title"),
    fields: [
      {
        path: ["rumbleCutoffHz"],
        label: (t) => t("settings.mic_tuning.rumble_cutoff"),
        min: 20,
        max: 300,
        step: 1,
        unit: "hz",
      },
      {
        path: ["equaliser", "bassHz"],
        label: (t) => t("settings.mic_tuning.bass_frequency"),
        min: 60,
        max: 1000,
        step: 5,
        unit: "hz",
      },
      {
        path: ["equaliser", "midHz"],
        label: (t) => t("settings.mic_tuning.mid_frequency"),
        min: 300,
        max: 5000,
        step: 10,
        unit: "hz",
      },
      {
        path: ["equaliser", "midQ"],
        label: (t) => t("settings.mic_tuning.mid_width"),
        min: 0.2,
        max: 5,
        step: 0.05,
        unit: "q",
      },
      {
        path: ["equaliser", "trebleHz"],
        label: (t) => t("settings.mic_tuning.treble_frequency"),
        min: 1500,
        max: 12000,
        step: 50,
        unit: "hz",
      },
    ],
  },
  {
    id: "limiter",
    title: (t) => t("settings.mic_tuning.limiter_title"),
    fields: [
      {
        path: ["limiter", "thresholdDb"],
        label: (t) => t("settings.mic_tuning.limiter_threshold"),
        min: -24,
        max: 0,
        step: 0.5,
        unit: "db",
      },
      {
        path: ["limiter", "kneeDb"],
        label: (t) => t("settings.mic_tuning.limiter_knee"),
        min: 0,
        max: 20,
        step: 0.5,
        unit: "db",
      },
      {
        path: ["limiter", "ratio"],
        label: (t) => t("settings.mic_tuning.limiter_ratio"),
        min: 1,
        max: 20,
        step: 0.5,
        unit: "ratio",
      },
      {
        path: ["limiter", "attackSeconds"],
        label: (t) => t("settings.mic_tuning.limiter_attack"),
        min: 0,
        max: 0.05,
        step: 0.0005,
        unit: "seconds",
      },
      {
        path: ["limiter", "releaseSeconds"],
        label: (t) => t("settings.mic_tuning.limiter_release"),
        min: 0.01,
        max: 1,
        step: 0.01,
        unit: "seconds",
      },
    ],
  },
  {
    id: "gate",
    title: (t) => t("settings.mic_tuning.gate_title"),
    fields: [
      {
        path: ["gate", "holdSeconds"],
        label: (t) => t("settings.mic_tuning.gate_hold"),
        min: 0,
        max: 1,
        step: 0.01,
        unit: "seconds",
      },
      {
        path: ["gate", "attackSeconds"],
        label: (t) => t("settings.mic_tuning.gate_attack"),
        min: 0.0005,
        max: 0.05,
        step: 0.0005,
        unit: "seconds",
      },
      {
        path: ["gate", "releaseSeconds"],
        label: (t) => t("settings.mic_tuning.gate_release"),
        min: 0.01,
        max: 1,
        step: 0.005,
        unit: "seconds",
      },
      {
        path: ["gate", "hysteresisDb"],
        label: (t) => t("settings.mic_tuning.gate_hysteresis"),
        min: 0,
        max: 20,
        step: 0.5,
        unit: "db",
      },
      {
        path: ["gate", "floorDb"],
        label: (t) => t("settings.mic_tuning.gate_floor"),
        min: -100,
        max: 0,
        step: 1,
        unit: "gateFloor",
      },
    ],
  },
];

export const micTuningFields: TuningField[] = micTuningGroups.flatMap(
  (group) => group.fields,
);

export function getTuning(tuning: MicTuning, path: TuningPath): number {
  if (path.length === 1) return tuning[path[0]];
  const [group, key] = path;
  return (tuning[group] as Record<string, number>)[key];
}

export function setTuning(
  tuning: MicTuning,
  path: TuningPath,
  value: number,
): MicTuning {
  if (path.length === 1) return { ...tuning, [path[0]]: value };
  const [group, key] = path;
  return { ...tuning, [group]: { ...tuning[group], [key]: value } };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
}

export function formatTuning(
  t: TFunction,
  field: TuningField,
  value: number,
): string {
  switch (field.unit) {
    case "hz":
      return value >= 1000
        ? t("settings.mic_tuning.value_khz", { value: round(value / 1000, 2) })
        : t("settings.mic_tuning.value_hz", { value: round(value, 0) });
    case "db":
      return t("settings.mic_tuning.value_db", { value: round(value, 1) });
    case "seconds":
      return t("settings.mic_tuning.value_ms", {
        value: round(value * 1000, 1),
      });
    case "samples":
      return t("settings.mic_tuning.value_delay", {
        ms: round(value * 1000, 2),
        samples: Math.round(value * SAMPLE_RATE),
      });
    case "ratio":
      return t("settings.mic_tuning.value_ratio", { value: round(value, 1) });
    case "q":
      return String(round(value, 2));
    case "noiseFloor":
      return value <= field.min
        ? t("settings.mic_tuning.value_full")
        : t("settings.mic_tuning.value_db", { value: round(value, 1) });
    case "gateFloor":
      return value <= field.min
        ? t("settings.mic_tuning.value_silent")
        : t("settings.mic_tuning.value_db", { value: round(value, 1) });
  }
}
