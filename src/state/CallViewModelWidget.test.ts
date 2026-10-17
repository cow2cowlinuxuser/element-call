/*
Copyright 2025 Element Creations Ltd.

  SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { it, vi, expect } from "vitest";
import { Subject } from "rxjs";

// import * as ComponentsCore from "@livekit/components-core";
import { withCallViewModel } from "./CallViewModel/CallViewModelTestUtils.ts";
import { type CallViewModel } from "./CallViewModel/CallViewModel.ts";
import { constant } from "./Behavior.ts";
import {
  aliceParticipant,
  aliceRtcMember,
  aliceUserId,
  bobId,
  bobRtcMember,
  bobUserId,
  localRtcMember,
} from "../utils/test-fixtures.ts";
import { mockRemoteParticipant } from "../utils/test.ts";
import {
  type FocusParticipantRequest,
  type HostBridge,
  type HostRequest,
  nullHostBridge,
  type ParticipantAudioRequest,
  type TileOverlayState,
} from "../HostBridge.ts";
import { type Layout } from "./layout-types.ts";
import { E2eeType } from "../e2ee/e2eeType.ts";
import { MatrixRTCMode } from "../config/ConfigOptions.ts";
import { peerAudio } from "../settings/settings.ts";
import { peerAudioFor } from "./PeerAudio.ts";

vi.mock("@livekit/components-core", { spy: true });

it.each([[MatrixRTCMode.Compatibility], [MatrixRTCMode.Matrix_2_0]])(
  "expect leave when the host asks us to hang up (%s mode)",
  async (mode) => {
    const pr = Promise.withResolvers<string>();
    const hangUp$ = new Subject<HostRequest<Record<string, never>>>();
    const hostBridge: HostBridge = { ...nullHostBridge, hangUp$ };
    const reply = vi.fn();

    withCallViewModel(mode)(
      {
        remoteParticipants$: constant([aliceParticipant]),
        rtcMembers$: constant([localRtcMember]),
      },
      (vm: CallViewModel) => {
        vm.leave$.subscribe((s: string) => {
          pr.resolve(s);
        });

        hangUp$.next({ data: {}, reply });
      },
      {
        encryptionSystem: { kind: E2eeType.PER_PARTICIPANT },
        hostBridge,
      },
    );

    const source = await pr.promise;
    expect(source).toBe("user");
    // The host expects to hear back that we acted on its request
    expect(reply).toHaveBeenCalledOnce();
  },
);

it("spotlights the participant the host asks to focus on", () => {
  const bobParticipant = mockRemoteParticipant({ identity: bobId });
  const focusParticipant$ = new Subject<HostRequest<FocusParticipantRequest>>();
  const hostBridge: HostBridge = { ...nullHostBridge, focusParticipant$ };
  const reply = vi.fn();
  let layout: Layout | undefined;

  withCallViewModel(MatrixRTCMode.Matrix_2_0)(
    {
      remoteParticipants$: constant([aliceParticipant, bobParticipant]),
      rtcMembers$: constant([localRtcMember, aliceRtcMember, bobRtcMember]),
    },
    (vm: CallViewModel) => {
      focusParticipant$.next({ data: { user_id: bobUserId }, reply });
      layout = vm.layout$.value;
    },
    { encryptionSystem: { kind: E2eeType.PER_PARTICIPANT }, hostBridge },
  );

  expect(reply).toHaveBeenCalledOnce();
  expect(layout?.type).toBe("spotlight-landscape");
  const spotlight =
    layout?.type === "spotlight-landscape" ? layout.spotlight.media$.value : [];
  expect(spotlight.map((m) => m.userId)).toEqual([bobUserId]);
});

it("tells the host who is in the call", () => {
  const notifyParticipants = vi.fn(async () => Promise.resolve());
  const hostBridge: HostBridge = { ...nullHostBridge, notifyParticipants };

  withCallViewModel(MatrixRTCMode.Matrix_2_0)(
    {
      remoteParticipants$: constant([aliceParticipant]),
      rtcMembers$: constant([localRtcMember, aliceRtcMember]),
    },
    () => {},
    { encryptionSystem: { kind: E2eeType.PER_PARTICIPANT }, hostBridge },
  );

  expect(notifyParticipants).toHaveBeenLastCalledWith({
    participants: [
      expect.objectContaining({ user_id: localRtcMember.userId, local: true }),
      expect.objectContaining({ user_id: aliceUserId, local: false }),
    ],
  });
});

it("applies participant audio adjustments and mute from the host", () => {
  const participantAudio$ = new Subject<HostRequest<ParticipantAudioRequest>>();
  const notifyParticipants = vi.fn(async () => Promise.resolve());
  const hostBridge: HostBridge = {
    ...nullHostBridge,
    participantAudio$,
    notifyParticipants,
  };
  const reply = vi.fn();

  withCallViewModel(MatrixRTCMode.Matrix_2_0)(
    {
      remoteParticipants$: constant([aliceParticipant]),
      rtcMembers$: constant([localRtcMember, aliceRtcMember]),
    },
    () => {
      participantAudio$.next({
        data: {
          user_id: aliceUserId,
          muted: true,
          volume: 0.4,
          pan: -0.5,
          bass: 6,
          mid: -3,
          treble: 4,
        },
        reply,
      });
    },
    { encryptionSystem: { kind: E2eeType.PER_PARTICIPANT }, hostBridge },
  );

  expect(reply).toHaveBeenCalledOnce();
  expect(peerAudioFor(peerAudio.getValue(), aliceUserId)).toEqual({
    volume: 0.4,
    pan: -0.5,
    bass: 6,
    mid: -3,
    treble: 4,
  });
  expect(notifyParticipants).toHaveBeenLastCalledWith({
    participants: [
      expect.objectContaining({ user_id: localRtcMember.userId, local: true }),
      expect.objectContaining({
        user_id: aliceUserId,
        local: false,
        playback_muted: true,
      }),
    ],
  });
});

it("notifies the host when the floating tile overlay opens and closes", () => {
  const notifyTileOverlay = vi.fn(async () => Promise.resolve());
  const tileOverlay$ = new Subject<HostRequest<TileOverlayState>>();
  const hostBridge: HostBridge = {
    ...nullHostBridge,
    notifyTileOverlay,
    tileOverlay$,
  };

  withCallViewModel(MatrixRTCMode.Matrix_2_0)(
    {
      remoteParticipants$: constant([aliceParticipant]),
      rtcMembers$: constant([localRtcMember, aliceRtcMember]),
    },
    (vm: CallViewModel) => {
      const media = vm.compactMedia$.value[0];
      expect(media).toBeDefined();
      vm.setExpandedMedia(media);
      expect(vm.expandedTile$.value).not.toBeNull();
      expect(notifyTileOverlay).toHaveBeenLastCalledWith({ open: true });

      const reply = vi.fn();
      tileOverlay$.next({ data: { open: false }, reply });
      expect(reply).toHaveBeenCalledOnce();
      expect(vm.expandedTile$.value).toBeNull();
      expect(notifyTileOverlay).toHaveBeenLastCalledWith({ open: false });
    },
    { encryptionSystem: { kind: E2eeType.PER_PARTICIPANT }, hostBridge },
  );
});
