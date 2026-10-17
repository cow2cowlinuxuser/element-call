/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  loadRnnoise,
  RnnoiseWorkletNode,
} from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

let wasmBinary: Promise<ArrayBuffer> | undefined;

/**
 * Creates an RNNoise node, which removes noise other than voices. RNNoise works
 * at 48 kHz only, so the context must run at that rate.
 */
export async function createNoiseReduction(
  context: AudioContext,
): Promise<RnnoiseWorkletNode> {
  wasmBinary ??= loadRnnoise({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseSimdWasmUrl,
  }).catch((e: unknown) => {
    wasmBinary = undefined;
    throw e;
  });
  const binary = await wasmBinary;
  await context.audioWorklet.addModule(rnnoiseWorkletUrl);
  return new RnnoiseWorkletNode(context, {
    maxChannels: 1,
    wasmBinary: binary,
  });
}
