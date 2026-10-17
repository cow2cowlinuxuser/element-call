/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { distinctUntilChanged, map, type Observable } from "rxjs";

import { micProcessing as micProcessingSetting } from "../settings/settings";
import { clamp, EQ_RANGE_DB } from "./PeerAudio";

/**
 * How the user wants their own microphone to sound to others, remembered on
 * this device.
 */
export interface MicProcessing {
  /**
   * Whether any of this applies. Off sends the microphone as the browser
   * captures it, keeping the rest so that it can be turned back on.
   */
  enabled: boolean;
  /** Whether to remove background noise with RNNoise. */
  noiseReduction: boolean;
  /** Whether to silence the microphone while it is quieter than the threshold. */
  gate: boolean;
  /** Level in dBFS below which the gate closes. */
  gateThreshold: number;
  /** Low shelf gain in dB. */
  bass: number;
  /** Mid band gain in dB. */
  mid: number;
  /** High shelf gain in dB. */
  treble: number;
}

export const GATE_THRESHOLD_MIN_DB = -80;
export const GATE_THRESHOLD_MAX_DB = -10;

export const defaultMicProcessing: MicProcessing = {
  enabled: true,
  noiseReduction: false,
  gate: false,
  gateThreshold: -50,
  bass: 0,
  mid: 0,
  treble: 0,
};

/**
 * The microphone settings, kept up to date with the stored settings.
 */
export function observeMicProcessing(): Observable<MicProcessing> {
  return micProcessingSetting.value$.pipe(
    map(micProcessingFrom),
    distinctUntilChanged(sameMicProcessing),
  );
}

export function getMicProcessing(): MicProcessing {
  return micProcessingFrom(micProcessingSetting.getValue());
}

/**
 * Stores changes to the microphone settings, clamped to their range.
 */
export function updateMicProcessing(changes: Partial<MicProcessing>): void {
  const next = micProcessingFrom({ ...getMicProcessing(), ...changes });
  micProcessingSetting.setValue(
    sameMicProcessing(next, defaultMicProcessing) ? {} : next,
  );
}

/**
 * Whether the microphone needs to pass through Web Audio processing to sound
 * the way the user asked for.
 */
export function needsMicProcessing(mic: MicProcessing): boolean {
  return (
    mic.enabled &&
    (mic.noiseReduction ||
      mic.gate ||
      mic.bass !== 0 ||
      mic.mid !== 0 ||
      mic.treble !== 0)
  );
}

/**
 * Whether the microphone that others hear should pass through the processor.
 * Showing the level needs it too, but never once processing is turned off.
 */
export function shouldProcessMic(
  mic: MicProcessing,
  levelWanted: boolean,
): boolean {
  return mic.enabled && (needsMicProcessing(mic) || levelWanted);
}

/**
 * Whether to ask the browser for its own noise suppression. Stacked with
 * RNNoise it makes voices sound robotic, so it gives way.
 */
export function wantsBrowserNoiseSuppression(
  browserSetting: boolean,
  mic: MicProcessing,
): boolean {
  return browserSetting && !(mic.enabled && mic.noiseReduction);
}

export function micProcessingFrom(
  stored: Partial<MicProcessing>,
): MicProcessing {
  const mic = { ...defaultMicProcessing, ...stored };
  return {
    enabled: mic.enabled !== false,
    noiseReduction: mic.noiseReduction === true,
    gate: mic.gate === true,
    gateThreshold: clamp(
      mic.gateThreshold,
      GATE_THRESHOLD_MIN_DB,
      GATE_THRESHOLD_MAX_DB,
      defaultMicProcessing.gateThreshold,
    ),
    bass: clamp(mic.bass, -EQ_RANGE_DB, EQ_RANGE_DB, 0),
    mid: clamp(mic.mid, -EQ_RANGE_DB, EQ_RANGE_DB, 0),
    treble: clamp(mic.treble, -EQ_RANGE_DB, EQ_RANGE_DB, 0),
  };
}

function sameMicProcessing(a: MicProcessing, b: MicProcessing): boolean {
  return (
    a.enabled === b.enabled &&
    a.noiseReduction === b.noiseReduction &&
    a.gate === b.gate &&
    a.gateThreshold === b.gateThreshold &&
    a.bass === b.bass &&
    a.mid === b.mid &&
    a.treble === b.treble
  );
}
