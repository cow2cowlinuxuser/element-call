/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  defaultMicProcessing,
  type MicProcessing,
} from "../src/state/MicProcessing";
import { voiceSettingsFrom, withDefaults } from "../src/state/MicTuning";
import { defaultMicTuning, type MicTuning } from "../src/livekit/MicProcessor";
import { defaultPeerAudio, type PeerAudio } from "../src/state/PeerAudio";

/** Everything the lab lets you change, as saved and exported. */
export interface LabState {
  /** What the user sets in Element's voice processing panel. */
  settings: MicProcessing;
  /** The chain's inner workings, which ship as `defaultMicTuning`. */
  tuning: MicTuning;
  /** How a listener has set up your voice on their end. */
  listener: PeerAudio;
}

export const defaultLabState: LabState = {
  settings: defaultMicProcessing,
  tuning: defaultMicTuning,
  listener: defaultPeerAudio,
};

const STORAGE_KEY = "audio-lab-state";

export function labStateFrom(value: unknown): LabState {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    ...voiceSettingsFrom(source),
    listener: withDefaults(defaultPeerAudio, source.listener),
  };
}
export function parseLabState(json: string): LabState {
  return labStateFrom(JSON.parse(json));
}

export function loadLabState(storage: Storage): LabState {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    return saved === null ? defaultLabState : parseLabState(saved);
  } catch {
    return defaultLabState;
  }
}

export function saveLabState(storage: Storage, state: LabState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
