/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { Track } from "livekit-client";
import { type Observable } from "rxjs";

import { MicProcessor, type MicTuning } from "../src/livekit/MicProcessor";
import {
  applyPeerAudio,
  createPeerAudioChain,
  type PeerAudioChain,
  tuneEqualiser,
} from "../src/livekit/PeerAudioChain";
import { type MicProcessing } from "../src/state/MicProcessing";
import { type PeerAudio } from "../src/state/PeerAudio";

export type ListenTo = "off" | "raw" | "processed";

export interface MicOptions {
  deviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

type SinkableContext = AudioContext & { setSinkId?(id: string): Promise<void> };

const ANALYSER_SIZE = 4096;

function createAnalyser(context: AudioContext): AnalyserNode {
  const analyser = context.createAnalyser();
  analyser.fftSize = ANALYSER_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  return analyser;
}

/**
 * Runs a source through Element's own microphone processor, the way a call
 * does, and plays either side of it back through a listener's chain.
 */
export class LabEngine {
  public readonly context: AudioContext = new AudioContext({
    // The rate the processor runs at, so that its output connects here as is
    sampleRate: 48000,
    latencyHint: "interactive",
  });
  public readonly rawAnalyser = createAnalyser(this.context);
  public readonly processedAnalyser = createAnalyser(this.context);
  public readonly processor: MicProcessor;
  public rawTrack?: MediaStreamTrack;

  private readonly listener: PeerAudioChain = createPeerAudioChain(
    this.context,
  );
  private stopSource?: () => void;
  private rawSource?: MediaStreamAudioSourceNode;
  private processedSource?: MediaStreamAudioSourceNode;
  private listenTo: ListenTo = "off";

  public constructor(
    settings$: Observable<MicProcessing>,
    tuning$: Observable<MicTuning>,
  ) {
    this.processor = new MicProcessor(settings$, undefined, tuning$);
    const nodes = this.listener.nodes;
    for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
    nodes[nodes.length - 1].connect(this.context.destination);
  }

  public get processedTrack(): MediaStreamTrack | undefined {
    return this.processor.processedTrack;
  }

  public async useMic(options: MicOptions): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        echoCancellation: options.echoCancellation,
        noiseSuppression: options.noiseSuppression,
        autoGainControl: options.autoGainControl,
        channelCount: 1,
      },
    });
    const track = stream.getAudioTracks()[0];
    await this.setSource(track, () => track.stop());
  }

  /** Loops a recording, so that every change can be heard on the same take. */
  public async useFile(file: File): Promise<void> {
    const buffer = await this.context.decodeAudioData(await file.arrayBuffer());
    const player = this.context.createBufferSource();
    player.buffer = buffer;
    player.loop = true;
    const output = this.context.createMediaStreamDestination();
    // A microphone track is mono
    output.channelCount = 1;
    output.channelCountMode = "explicit";
    player.connect(output);
    player.start();
    await this.setSource(output.stream.getAudioTracks()[0], () => {
      player.stop();
      player.disconnect();
    });
  }

  public setListenTo(listenTo: ListenTo): void {
    this.listenTo = listenTo;
    this.rawAnalyser.disconnect();
    this.processedAnalyser.disconnect();
    const input = this.listener.nodes[0];
    if (listenTo === "raw") this.rawAnalyser.connect(input);
    if (listenTo === "processed") this.processedAnalyser.connect(input);
  }

  public getListenTo(): ListenTo {
    return this.listenTo;
  }

  public setListener(audio: PeerAudio, tuning: MicTuning): void {
    tuneEqualiser(this.listener, tuning.equaliser);
    applyPeerAudio(
      this.listener,
      audio,
      { pan: 0, volume: audio.volume },
      this.context.currentTime,
    );
  }

  public static get canChooseOutput(): boolean {
    return "setSinkId" in AudioContext.prototype;
  }

  public async setOutputDevice(deviceId: string): Promise<void> {
    await (this.context as SinkableContext).setSinkId?.(deviceId);
  }

  public async destroy(): Promise<void> {
    this.stopSource?.();
    this.stopSource = undefined;
    await this.processor.destroy();
    await this.context.close();
  }

  private async setSource(
    track: MediaStreamTrack,
    stop: () => void,
  ): Promise<void> {
    await this.context.resume();
    this.stopSource?.();
    this.stopSource = stop;
    this.rawTrack = track;
    this.rawSource?.disconnect();
    this.rawSource = this.context.createMediaStreamSource(
      new MediaStream([track]),
    );
    this.rawSource.connect(this.rawAnalyser);

    const options = {
      kind: Track.Kind.Audio,
      track,
      audioContext: this.context,
    } as const;
    if (this.processedSource) {
      await this.processor.restart(options);
      return;
    }
    await this.processor.init(options);
    this.processedSource = this.context.createMediaStreamSource(
      new MediaStream([this.processor.processedTrack!]),
    );
    this.processedSource.connect(this.processedAnalyser);
  }
}

export interface Recording {
  stop(): Promise<Blob>;
}

export function record(track: MediaStreamTrack): Recording {
  const recorder = new MediaRecorder(new MediaStream([track]));
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e): void => {
    chunks.push(e.data);
  };
  recorder.start();
  return {
    stop: async (): Promise<Blob> =>
      new Promise((resolve) => {
        recorder.onstop = (): void =>
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        recorder.stop();
      }),
  };
}
