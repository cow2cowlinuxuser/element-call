/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test } from "vitest";

import { peerAudio } from "../settings/settings";
import {
  defaultPeerAudio,
  EQ_RANGE_DB,
  needsAudioProcessing,
  observePeerAudio,
  type PeerAudio,
  peerAudioFor,
  updatePeerAudio,
} from "./PeerAudio";

afterEach(() => peerAudio.setValue({}));

test("a user without settings sounds as they are", () => {
  expect(peerAudioFor({}, "@alice:example.org")).toEqual(defaultPeerAudio);
});

test("settings are stored per user", () => {
  updatePeerAudio("@alice:example.org", { pan: -1 });
  updatePeerAudio("@bob:example.org", { bass: 3 });

  expect(peerAudioFor(peerAudio.getValue(), "@alice:example.org")).toEqual({
    ...defaultPeerAudio,
    pan: -1,
  });
  expect(peerAudioFor(peerAudio.getValue(), "@bob:example.org")).toEqual({
    ...defaultPeerAudio,
    bass: 3,
  });
});

test("settings are clamped to their range", () => {
  updatePeerAudio("@alice:example.org", {
    volume: 3,
    pan: -4,
    bass: EQ_RANGE_DB * 2,
    mid: -EQ_RANGE_DB * 2,
    treble: Number.NaN,
  });

  expect(peerAudioFor(peerAudio.getValue(), "@alice:example.org")).toEqual({
    volume: 1,
    pan: -1,
    bass: EQ_RANGE_DB,
    mid: -EQ_RANGE_DB,
    treble: 0,
  });
});

test("stored values that are not numbers fall back to the default", () => {
  const stored = { "@alice:example.org": { pan: "left", bass: null } };

  expect(
    peerAudioFor(
      stored as unknown as Record<string, Partial<PeerAudio>>,
      "@alice:example.org",
    ),
  ).toEqual(defaultPeerAudio);
});

test("a user whose settings return to default is forgotten", () => {
  updatePeerAudio("@alice:example.org", { mid: 4 });
  updatePeerAudio("@alice:example.org", { mid: 0 });

  expect(peerAudio.getValue()).toEqual({});
});

test("observing a user emits only when their settings change", () => {
  const seen: PeerAudio[] = [];
  const subscription = observePeerAudio("@alice:example.org").subscribe((a) =>
    seen.push(a),
  );

  updatePeerAudio("@bob:example.org", { pan: 1 });
  updatePeerAudio("@alice:example.org", { treble: -6 });
  subscription.unsubscribe();

  expect(seen).toEqual([defaultPeerAudio, { ...defaultPeerAudio, treble: -6 }]);
});

test("only pan and equaliser changes need audio processing", () => {
  expect(needsAudioProcessing(defaultPeerAudio)).toBe(false);
  expect(needsAudioProcessing({ ...defaultPeerAudio, pan: 0.1 })).toBe(true);
  expect(needsAudioProcessing({ ...defaultPeerAudio, bass: -1 })).toBe(true);
  expect(needsAudioProcessing({ ...defaultPeerAudio, mid: 1 })).toBe(true);
  expect(needsAudioProcessing({ ...defaultPeerAudio, treble: 2 })).toBe(true);
});
