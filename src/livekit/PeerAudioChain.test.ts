/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { expect, test } from "vitest";

import {
  applyPeerAudio,
  createPeerAudioChain,
  defaultEqualiserTuning,
  equaliserHeadroom,
  rampTo,
} from "./PeerAudioChain";
import { fakeAudioParam } from "../utils/test";

test("the chain is an equaliser followed by gain and pan", () => {
  const chain = createPeerAudioChain(mockAudioContext());

  expect(chain.nodes).toEqual([
    chain.bass,
    chain.mid,
    chain.treble,
    chain.gain,
    chain.pan,
  ]);
  expect(chain.bass).toMatchObject({
    type: "lowshelf",
    frequency: { value: defaultEqualiserTuning.bassHz },
  });
  expect(chain.mid).toMatchObject({
    type: "peaking",
    frequency: { value: defaultEqualiserTuning.midHz },
    Q: { value: defaultEqualiserTuning.midQ },
  });
  expect(chain.treble).toMatchObject({
    type: "highshelf",
    frequency: { value: defaultEqualiserTuning.trebleHz },
  });
});

test("the bands can be tuned", () => {
  const chain = createPeerAudioChain(mockAudioContext(), {
    bassHz: 120,
    midHz: 2000,
    midQ: 0.5,
    trebleHz: 8000,
  });

  expect(chain.bass.frequency.value).toBe(120);
  expect(chain.mid.frequency.value).toBe(2000);
  expect(chain.mid.Q.value).toBe(0.5);
  expect(chain.treble.frequency.value).toBe(8000);
});

test("the member's settings shape the chain", () => {
  const chain = createPeerAudioChain(mockAudioContext());

  applyPeerAudio(
    chain,
    { pan: 0.5, bass: -6, mid: 3, treble: 12 },
    { pan: 0, volume: 1 },
    0,
  );

  expect(chain.bass.gain.value).toBe(-6);
  expect(chain.mid.gain.value).toBe(3);
  expect(chain.treble.gain.value).toBe(12);
  expect(chain.pan.pan.value).toBe(0.5);
});

test("boosts are made room for so that they do not clip", () => {
  const chain = createPeerAudioChain(mockAudioContext());

  applyPeerAudio(
    chain,
    { pan: 0, bass: 6, mid: -3, treble: 12 },
    { pan: 0, volume: 0.5 },
    0,
  );

  expect(chain.gain.gain.value).toBeCloseTo(0.5 * 10 ** (-12 / 20));
});

test("cuts need no headroom", () => {
  expect(equaliserHeadroom({ bass: -6, mid: 0, treble: -24 })).toBe(1);
  expect(equaliserHeadroom({ bass: 20, mid: 0, treble: 0 })).toBeCloseTo(0.1);
});

test("earpiece emulation overrides the member's pan", () => {
  const chain = createPeerAudioChain(mockAudioContext());

  applyPeerAudio(
    chain,
    { pan: -0.5, bass: 0, mid: 0, treble: 0 },
    { pan: 1, volume: 0.1 },
    0,
  );

  expect(chain.pan.pan.value).toBe(1);
  expect(chain.gain.gain.value).toBe(0.1);
});

test("changes glide rather than jump, which would click", () => {
  const param = fakeAudioParam(0);
  rampTo(param as unknown as AudioParam, 6, 2);

  expect(param.cancelScheduledValues).toHaveBeenCalledWith(2);
  expect(param.setTargetAtTime).toHaveBeenCalledWith(6, 2, expect.any(Number));
});

function mockAudioContext(): AudioContext {
  return {
    createBiquadFilter: () => ({
      type: "peaking",
      frequency: { value: 350 },
      Q: { value: 1 },
      gain: fakeAudioParam(0),
    }),
    createGain: () => ({ gain: fakeAudioParam(1) }),
    createStereoPanner: () => ({ pan: fakeAudioParam(0) }),
  } as unknown as AudioContext;
}
