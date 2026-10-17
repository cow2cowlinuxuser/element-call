/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { BehaviorSubject } from "rxjs";

import { findFocusedMedia, observeCallParticipants$ } from "./callParticipants";
import { type WrappedUserMediaViewModel } from "../media/WrappedUserMediaViewModel";
import { type ScreenShareViewModel } from "../media/ScreenShareViewModel";
import { type CallParticipant } from "../../HostBridge";

interface FakeMedia {
  vm: WrappedUserMediaViewModel;
  speaking$: BehaviorSubject<boolean>;
  screenShares$: BehaviorSubject<ScreenShareViewModel[]>;
}

function fakeMedia(id: string, userId: string, local = false): FakeMedia {
  const speaking$ = new BehaviorSubject(false);
  const screenShares$ = new BehaviorSubject<ScreenShareViewModel[]>([]);
  const vm = {
    id,
    userId,
    local,
    type: "user",
    displayName$: new BehaviorSubject(userId.slice(1, userId.indexOf(":"))),
    speaking$,
    audioEnabled$: new BehaviorSubject(true),
    videoEnabled$: new BehaviorSubject(false),
    screenShares$,
  } as unknown as WrappedUserMediaViewModel;
  return { vm, speaking$, screenShares$ };
}

describe("observeCallParticipants$", () => {
  it("reports nobody for an empty call", () => {
    const seen: CallParticipant[][] = [];
    observeCallParticipants$(new BehaviorSubject([])).subscribe((p) =>
      seen.push(p),
    );
    expect(seen).toEqual([[]]);
  });

  it("reports each participant and follows their speaking and sharing", () => {
    const local = fakeMedia("local:0", "@me:example.org", true);
    const alice = fakeMedia("alice:0", "@alice:example.org");
    const seen: CallParticipant[][] = [];
    observeCallParticipants$(
      new BehaviorSubject([local.vm, alice.vm]),
    ).subscribe((p) => seen.push(p));

    expect(seen.at(-1)).toEqual([
      {
        id: "local:0",
        user_id: "@me:example.org",
        display_name: "me",
        local: true,
        speaking: false,
        audio_enabled: true,
        video_enabled: false,
        screen_sharing: false,
      },
      {
        id: "alice:0",
        user_id: "@alice:example.org",
        display_name: "alice",
        local: false,
        speaking: false,
        audio_enabled: true,
        video_enabled: false,
        screen_sharing: false,
      },
    ]);

    local.speaking$.next(true);
    expect(seen.at(-1)?.[0].speaking).toBe(true);

    alice.screenShares$.next([{} as ScreenShareViewModel]);
    expect(seen.at(-1)?.[1].screen_sharing).toBe(true);
  });

  it("doesn't repeat itself when nothing it reports has changed", () => {
    const alice = fakeMedia("alice:0", "@alice:example.org");
    const seen: CallParticipant[][] = [];
    observeCallParticipants$(new BehaviorSubject([alice.vm])).subscribe((p) =>
      seen.push(p),
    );
    alice.speaking$.next(false);
    expect(seen).toHaveLength(1);
  });
});

describe("findFocusedMedia", () => {
  const local = fakeMedia("local:0", "@me:example.org", true).vm;
  const meElsewhere = fakeMedia("me2:0", "@me:example.org").vm;
  const alice = fakeMedia("alice:0", "@alice:example.org").vm;

  it("finds nothing without a user to focus", () => {
    expect(findFocusedMedia(null, [local, alice])).toBeUndefined();
  });

  it("finds the user's media", () => {
    expect(findFocusedMedia("@alice:example.org", [local, alice])).toBe(alice);
  });

  it("prefers a remote device over the local one", () => {
    expect(
      findFocusedMedia("@me:example.org", [local, meElsewhere, alice]),
    ).toBe(meElsewhere);
    expect(findFocusedMedia("@me:example.org", [local, alice])).toBe(local);
  });

  it("finds nothing for someone who isn't in the call", () => {
    expect(
      findFocusedMedia("@bob:example.org", [local, alice]),
    ).toBeUndefined();
  });
});
