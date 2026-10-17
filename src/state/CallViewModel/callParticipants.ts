/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  combineLatest,
  distinctUntilChanged,
  type Observable,
  of,
  switchMap,
} from "rxjs";
import { deepCompare } from "matrix-js-sdk/lib/utils";

import { type CallParticipant } from "../../HostBridge.ts";
import { type WrappedUserMediaViewModel } from "../media/WrappedUserMediaViewModel.ts";

/**
 * Summarises the user media in a call into what the host needs to show who is
 * there, who is talking and who is sharing their screen.
 */
export function observeCallParticipants$(
  userMedia$: Observable<WrappedUserMediaViewModel[]>,
): Observable<CallParticipant[]> {
  return userMedia$.pipe(
    switchMap((userMedia) =>
      userMedia.length === 0
        ? of([])
        : combineLatest(
            userMedia.map((media) => {
              const playbackMuted$ =
                !media.local && "playbackMuted$" in media
                  ? media.playbackMuted$
                  : of(false);
              return combineLatest(
                [
                  media.displayName$,
                  media.speaking$,
                  media.audioEnabled$,
                  media.videoEnabled$,
                  media.screenShares$,
                  playbackMuted$,
                ],
                (
                  displayName,
                  speaking,
                  audioEnabled,
                  videoEnabled,
                  screenShares,
                  playbackMuted,
                ): CallParticipant => ({
                  id: media.id,
                  user_id: media.userId,
                  display_name: displayName,
                  local: media.local,
                  speaking,
                  audio_enabled: audioEnabled,
                  video_enabled: videoEnabled,
                  screen_sharing: screenShares.length > 0,
                  ...(playbackMuted ? { playback_muted: true } : {}),
                }),
              );
            }),
          ),
    ),
    distinctUntilChanged(deepCompare),
  );
}

/**
 * Finds the media to focus on for the given user, preferring a remote device
 * over the local one (in case the local user is also in the call elsewhere).
 */
export function findFocusedMedia(
  userId: string | null,
  userMedia: WrappedUserMediaViewModel[],
): WrappedUserMediaViewModel | undefined {
  if (userId === null) return undefined;
  return (
    userMedia.find((m) => m.userId === userId && !m.local) ??
    userMedia.find((m) => m.userId === userId)
  );
}
