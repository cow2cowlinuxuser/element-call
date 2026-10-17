/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type PeerAudio } from "../state/PeerAudio";

/**
 * The Web Audio nodes one remote audio track plays through: a three band
 * equaliser, then the gain and stereo position.
 */
export interface PeerAudioChain {
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  /** The nodes in playback order, as LiveKit's Web Audio plugins. */
  nodes: AudioNode[];
}

export interface EarpieceAudio {
  pan: number;
  volume: number;
}

/** Where the equaliser's bands sit. */
export interface EqualiserTuning {
  /** Low shelf corner frequency. */
  bassHz: number;
  /** Mid band centre frequency. */
  midHz: number;
  /** Mid band width: higher is narrower. */
  midQ: number;
  /** High shelf corner frequency. */
  trebleHz: number;
}

export const defaultEqualiserTuning: EqualiserTuning = {
  bassHz: 250,
  midHz: 1000,
  midQ: 1,
  trebleHz: 4000,
};

/** Long enough that dragging a slider does not crackle. */
const SMOOTHING_SECONDS = 0.02;

/**
 * Moves a parameter smoothly to a new value, since jumping makes a click.
 */
export function rampTo(param: AudioParam, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, SMOOTHING_SECONDS);
}

/**
 * The gain that makes room for the equaliser's largest boost, so that boosted
 * peaks do not go past full scale and clip.
 */
export function equaliserHeadroom(
  audio: Pick<PeerAudio, "bass" | "mid" | "treble">,
): number {
  return 10 ** (-Math.max(0, audio.bass, audio.mid, audio.treble) / 20);
}

export function createPeerAudioChain(
  context: AudioContext,
  tuning = defaultEqualiserTuning,
): PeerAudioChain {
  const equaliser = createEqualiser(context, tuning);
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  return {
    ...equaliser,
    gain,
    pan,
    nodes: [equaliser.bass, equaliser.mid, equaliser.treble, gain, pan],
  };
}

interface Equaliser {
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
}

export function createEqualiser(
  context: AudioContext,
  tuning: EqualiserTuning,
): Equaliser {
  const equaliser = {
    bass: createFilter(context, "lowshelf"),
    mid: createFilter(context, "peaking"),
    treble: createFilter(context, "highshelf"),
  };
  tuneEqualiser(equaliser, tuning);
  return equaliser;
}

export function tuneEqualiser(
  equaliser: Equaliser,
  tuning: EqualiserTuning,
): void {
  equaliser.bass.frequency.value = tuning.bassHz;
  equaliser.mid.frequency.value = tuning.midHz;
  equaliser.mid.Q.value = tuning.midQ;
  equaliser.treble.frequency.value = tuning.trebleHz;
}

/**
 * Sets the chain to play a track as the user asked. Earpiece emulation has to
 * send everything to one ear, so its pan replaces the user's own.
 */
export function applyPeerAudio(
  chain: PeerAudioChain,
  audio: Pick<PeerAudio, "pan" | "bass" | "mid" | "treble">,
  earpiece: EarpieceAudio,
  now: number,
): void {
  rampTo(chain.bass.gain, audio.bass, now);
  rampTo(chain.mid.gain, audio.mid, now);
  rampTo(chain.treble.gain, audio.treble, now);
  rampTo(chain.gain.gain, earpiece.volume * equaliserHeadroom(audio), now);
  rampTo(chain.pan.pan, earpiece.pan !== 0 ? earpiece.pan : audio.pan, now);
}

function createFilter(
  context: AudioContext,
  type: BiquadFilterType,
): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = type;
  return filter;
}
