/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  getTrackReferenceId,
  type TrackReference,
} from "@livekit/components-core";
import { type Room as LivekitRoom } from "livekit-client";
import { type RemoteAudioTrack, Track } from "livekit-client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useTracks,
  AudioTrack,
  type AudioTrackProps,
} from "@livekit/components-react";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import { useEarpieceAudioConfig } from "../MediaDevicesContext";
import { useReactiveState } from "../useReactiveState";
import { useBehavior } from "../useBehavior";
import * as controls from "../controls";
import { peerAudio as peerAudioSetting } from "../settings/settings";
import {
  defaultPeerAudio,
  needsAudioProcessing,
  type PeerAudio,
  peerAudioFor,
} from "../state/PeerAudio";
import { applyPeerAudio, createPeerAudioChain } from "./PeerAudioChain";

export interface MatrixAudioRendererProps {
  /**
   * The service URL of the LiveKit room.
   */
  url: string;
  livekitRoom: LivekitRoom;
  /**
   * The list of participant identities to render audio for.
   * This list needs to be composed based on the matrixRTC members so that we do not play audio from users
   * that are not expected to be in the rtc session (local user is excluded).
   */
  validIdentities: string[];
  /**
   * The Matrix user ID behind each participant identity, for applying the
   * user's per member audio settings.
   */
  userIds: Record<string, string>;
  /**
   * If set to `true`, mutes all audio tracks rendered by the component.
   * @remarks
   * If set to `true`, the server will stop sending audio track data to the client.
   */
  muted?: boolean;
}

/**
 * Takes care of handling remote participants’ audio tracks and makes sure that microphones and screen share are audible.
 *
 * It also takes care of the earpiece audio configuration for iOS devices.
 * This is done by using the WebAudio API to create a stereo pan effect that mimics the earpiece audio.
 * @example
 * ```tsx
 * <LiveKitRoom>
 *   <MatrixAudioRenderer />
 * </LiveKitRoom>
 * ```
 * @public
 */
export function LivekitRoomAudioRenderer({
  url,
  livekitRoom,
  validIdentities,
  userIds,
  muted,
}: MatrixAudioRendererProps): ReactNode {
  const logger = rootLogger.getChild("[MatrixAudioRenderer]");
  // Identities we have already warned about, so that re-renders (which happen
  // on every active speaker update) don't repeat the warning.
  const warnedIdentities = useRef(new Set<string>());
  const tracks = useTracks(
    [
      Track.Source.Microphone,
      Track.Source.ScreenShareAudio,
      Track.Source.Unknown,
    ],
    {
      updateOnlyOn: [],
      onlySubscribed: true,
      room: livekitRoom,
    },
  )
    // Only keep remote audio tracks (we never render our own audio)
    .filter(
      (ref) =>
        ref.publication.kind === Track.Kind.Audio && !ref.participant.isLocal,
    )
    // Only keep tracks from participants that are in the validIdentities list
    .filter((ref) => {
      const { identity } = ref.participant;
      const isValid = validIdentities.includes(identity);
      if (!isValid && !warnedIdentities.current.has(identity)) {
        warnedIdentities.current.add(identity);
        // Log that there is an invalid identity, that means that someone is publishing audio that is not expected to be in the call.
        logger.warn(
          `Audio track ${identity} from ${url} has no matching matrix call member`,
          `current members: ${validIdentities.join()}`,
          `track will not get rendered`,
        );
      } else if (isValid) {
        warnedIdentities.current.delete(identity);
      }
      return isValid;
    });

  // This component is also (in addition to the "only play audio for connected members" logic above)
  // responsible for mimicking earpiece audio on iPhones.
  // The Safari audio devices enumeration does not expose an earpiece audio device.
  // We alternatively use the audioContext pan node to only use one of the stereo channels.

  // This component does get additionally complicated because of a Safari bug.
  // (see: https://bugs.webkit.org/show_bug.cgi?id=251532
  // and the related issues: https://bugs.webkit.org/show_bug.cgi?id=237878
  // and https://bugs.webkit.org/show_bug.cgi?id=231105)
  //
  // AudioContext gets stopped if the webview gets moved into the background.
  // Once the phone is in standby audio playback will stop.
  // So we can only use the pan trick only works is the phone is not in standby.
  // If earpiece mode is not used we do not use audioContext to allow standby playback.
  // shouldUseAudioContext is set to false if stereoPan === 0 to allow standby bluetooth playback.

  // The same applies to the per member pan and equaliser: a track only plays
  // through the audio context while it needs processing.
  const { pan: earpiecePan, volume: earpieceVolume } = useEarpieceAudioConfig();
  const peerAudioSettings = useBehavior(peerAudioSetting.value$);

  // initialize the potentially used audio context.
  const [audioContext, setAudioContext] = useState<AudioContext | undefined>(
    undefined,
  );
  useEffect(() => {
    const ctx = new AudioContext();
    setAudioContext(ctx);
    return (): void => {
      void ctx.close();
    };
  }, []);

  return (
    // We add all audio elements into one <div> for the browser developer tool experience/tidyness.
    <div style={{ display: "none" }}>
      {tracks.map((trackRef) => {
        const userId = userIds[trackRef.participant.identity];
        return (
          <PeerAudioTrack
            key={getTrackReferenceId(trackRef)}
            trackRef={trackRef}
            muted={muted}
            audioContext={audioContext}
            peerAudio={
              userId !== undefined &&
              trackRef.source !== Track.Source.ScreenShareAudio
                ? peerAudioFor(peerAudioSettings, userId)
                : defaultPeerAudio
            }
            earpiecePan={earpiecePan}
            earpieceVolume={earpieceVolume}
          />
        );
      })}
    </div>
  );
}

interface PeerAudioTrackProps {
  trackRef: TrackReference;
  muted?: boolean;
  audioContext?: AudioContext;
  peerAudio: PeerAudio;
  earpiecePan: number;
  earpieceVolume: number;
}

/**
 * Plays one remote audio track, through its own pan and equaliser nodes when the
 * member's audio settings or earpiece emulation call for them.
 */
function PeerAudioTrack({
  trackRef,
  muted,
  audioContext,
  peerAudio: { pan, bass, mid, treble },
  earpiecePan,
  earpieceVolume,
}: PeerAudioTrackProps): ReactNode {
  const processed =
    earpiecePan !== 0 || needsAudioProcessing({ pan, bass, mid, treble });
  const chain = useMemo(
    () =>
      processed && audioContext
        ? createPeerAudioChain(audioContext)
        : undefined,
    [processed, audioContext],
  );
  useEffect(() => {
    if (chain && audioContext)
      applyPeerAudio(
        chain,
        { pan, bass, mid, treble },
        { pan: earpiecePan, volume: earpieceVolume },
        audioContext.currentTime,
      );
  }, [
    chain,
    audioContext,
    pan,
    bass,
    mid,
    treble,
    earpiecePan,
    earpieceVolume,
  ]);

  return (
    <AudioTrackWithAudioNodes
      trackRef={trackRef}
      muted={muted}
      audioContext={chain && audioContext}
      audioNodes={chain?.nodes}
    />
  );
}

interface StereoPanAudioTrackProps {
  muted?: boolean;
  audioContext?: AudioContext;
  audioNodes?: AudioNode[];
}

/**
 * This wraps `livekit.AudioTrack` to allow adding audio nodes to a track.
 * It main purpose is to remount the AudioTrack component when switching from
 * audioContext to normal audio playback.
 * As of now the AudioTrack component does not support adding audio nodes while being mounted.
 * @param props The component props
 * @param props.trackRef The track reference
 * @param props.muted If the track should be muted
 * @param props.audioContext The audio context to use
 * @param props.audioNodes The audio nodes to use
 * @returns
 */
function AudioTrackWithAudioNodes({
  trackRef,
  muted,
  audioContext,
  audioNodes,
  ...props
}: StereoPanAudioTrackProps &
  AudioTrackProps &
  React.RefAttributes<HTMLAudioElement>): ReactNode {
  // This is used to unmount/remount the AudioTrack component.
  // Mounting needs to happen after the audioContext is set.
  // (adding the audio context when already mounted did not work outside strict mode)
  const [trackReady, setTrackReady] = useReactiveState(
    () => false,
    // We only want the track to reset once both (audioNodes and audioContext) are set.
    // for unsetting the audioContext its enough if one of the two is undefined.
    [audioContext && audioNodes],
  );

  useEffect(() => {
    if (!trackRef || trackReady) return;
    const track = trackRef.publication.track as RemoteAudioTrack;
    const useContext = audioContext && audioNodes;
    track.setAudioContext(useContext ? audioContext : undefined);
    track.setWebAudioPlugins(useContext ? audioNodes : []);
    setTrackReady(true);
    controls.setPlaybackStarted();
  }, [audioContext, audioNodes, setTrackReady, trackReady, trackRef]);

  return (
    trackReady && <AudioTrack trackRef={trackRef} muted={muted} {...props} />
  );
}
