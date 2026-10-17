/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { distinctUntilChanged, map, type Observable } from "rxjs";

import { micTuning as micTuningSetting } from "../settings/settings";
import { defaultMicTuning, type MicTuning } from "../livekit/MicProcessor";
import {
  getTuning,
  micTuningFields,
  setTuning,
} from "../livekit/micTuningFields";
import { clamp } from "./PeerAudio";
import {
  defaultMicProcessing,
  type MicProcessing,
  micProcessingFrom,
} from "./MicProcessing";

/**
 * Fills in whatever is missing or of the wrong type with the default, so that
 * stored or pasted settings from another version cannot break the chain.
 */
export function withDefaults<T>(defaults: T, value: unknown): T {
  if (typeof defaults !== "object" || defaults === null) {
    return typeof value === typeof defaults &&
      !(typeof value === "number" && !Number.isFinite(value))
      ? (value as T)
      : defaults;
  }
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      withDefaults(fallback, source[key]),
    ]),
  ) as T;
}

export function micTuningFrom(value: unknown): MicTuning {
  let tuning = withDefaults(defaultMicTuning, value);
  for (const field of micTuningFields) {
    const current = getTuning(tuning, field.path);
    tuning = setTuning(
      tuning,
      field.path,
      clamp(current, field.min, field.max, current),
    );
  }
  return tuning;
}

function sameMicTuning(a: MicTuning, b: MicTuning): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The microphone tuning, kept up to date with the stored tuning. */
export function observeMicTuning(): Observable<MicTuning> {
  return micTuningSetting.value$.pipe(
    map(micTuningFrom),
    distinctUntilChanged(sameMicTuning),
  );
}

export function getMicTuning(): MicTuning {
  return micTuningFrom(micTuningSetting.getValue());
}

export function updateMicTuning(tuning: MicTuning): void {
  const next = micTuningFrom(tuning);
  micTuningSetting.setValue(sameMicTuning(next, defaultMicTuning) ? {} : next);
}

/** Everything about the user's voice processing, as copied and pasted. */
export interface VoiceSettings {
  settings: MicProcessing;
  tuning: MicTuning;
}

/** Reads voice settings as copied from Element Call or the audio lab. */
export function voiceSettingsFrom(value: unknown): VoiceSettings {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    settings: micProcessingFrom(
      withDefaults(defaultMicProcessing, source.settings),
    ),
    tuning: micTuningFrom(source.tuning),
  };
}
