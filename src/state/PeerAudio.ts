/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { distinctUntilChanged, map, type Observable } from "rxjs";

import { peerAudio as peerAudioSetting } from "../settings/settings";

/**
 * How the user wants to hear another call member, remembered on this device per
 * Matrix user.
 */
export interface PeerAudio {
  /** Playback volume, as a scalar multiplier. */
  volume: number;
  /** Stereo position, from -1 (left) to 1 (right). */
  pan: number;
  /** Low shelf gain in dB. */
  bass: number;
  /** Mid band gain in dB. */
  mid: number;
  /** High shelf gain in dB. */
  treble: number;
}

export type PeerAudioSettings = Record<string, Partial<PeerAudio>>;

export const EQ_RANGE_DB = 24;

export const defaultPeerAudio: PeerAudio = {
  volume: 1,
  pan: 0,
  bass: 0,
  mid: 0,
  treble: 0,
};

/**
 * The audio settings of one user, kept up to date with the stored settings.
 */
export function observePeerAudio(userId: string): Observable<PeerAudio> {
  return peerAudioSetting.value$.pipe(
    map((all) => peerAudioFor(all, userId)),
    distinctUntilChanged(samePeerAudio),
  );
}

/**
 * Stores changes to a user's audio settings. Values are clamped to their range,
 * and a user whose settings are all back to default is forgotten.
 */
export function updatePeerAudio(
  userId: string,
  changes: Partial<PeerAudio>,
): void {
  const all = peerAudioSetting.getValue();
  const next = clampPeerAudio({ ...peerAudioFor(all, userId), ...changes });
  const others = { ...all };
  delete others[userId];
  peerAudioSetting.setValue(
    samePeerAudio(next, defaultPeerAudio)
      ? others
      : { ...others, [userId]: next },
  );
}

/**
 * Whether the user's audio needs to pass through Web Audio processing to sound
 * the way they asked for. Volume alone does not.
 */
export function needsAudioProcessing(
  audio: Pick<PeerAudio, "pan" | "bass" | "mid" | "treble">,
): boolean {
  return (
    audio.pan !== 0 || audio.bass !== 0 || audio.mid !== 0 || audio.treble !== 0
  );
}

export function peerAudioFor(
  all: PeerAudioSettings,
  userId: string,
): PeerAudio {
  return clampPeerAudio({ ...defaultPeerAudio, ...all[userId] });
}

function clampPeerAudio(audio: PeerAudio): PeerAudio {
  return {
    volume: clamp(audio.volume, 0, 1, defaultPeerAudio.volume),
    pan: clamp(audio.pan, -1, 1, defaultPeerAudio.pan),
    bass: clamp(audio.bass, -EQ_RANGE_DB, EQ_RANGE_DB, defaultPeerAudio.bass),
    mid: clamp(audio.mid, -EQ_RANGE_DB, EQ_RANGE_DB, defaultPeerAudio.mid),
    treble: clamp(
      audio.treble,
      -EQ_RANGE_DB,
      EQ_RANGE_DB,
      defaultPeerAudio.treble,
    ),
  };
}

/**
 * Clamps a stored number to its range, falling back for anything that is not a
 * number.
 */
export function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function samePeerAudio(a: PeerAudio, b: PeerAudio): boolean {
  return (
    a.volume === b.volume &&
    a.pan === b.pan &&
    a.bass === b.bass &&
    a.mid === b.mid &&
    a.treble === b.treble
  );
}
