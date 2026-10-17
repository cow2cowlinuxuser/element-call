/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// An AudioWorklet module, loaded by URL and served as it is: it must not import
// anything, and it runs in the worklet's own global scope.

const REPORT_SECONDS = 0.05;
const SILENCE_DB = -120;

/**
 * A noise gate that turns its input down while it is quieter than a threshold,
 * and reports the input level to the main thread for a level meter.
 */
class MicGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const param = (name, defaultValue, minValue, maxValue) => ({
      name,
      defaultValue,
      minValue,
      maxValue,
      automationRate: "k-rate",
    });
    return [
      param("threshold", -50, -100, 0),
      param("enabled", 0, 0, 1),
      // How long the gate stays open once the voice drops
      param("hold", 0.3, 0, 2),
      param("attack", 0.0105, 0.0001, 1),
      param("release", 0.36, 0.001, 2),
      // Once open, the gate stays open until the level falls this far below
      // the threshold, so that a voice hovering around it does not flutter
      param("hysteresis", 6, 0, 30),
      // How far a closed gate turns the sound down. Turning it down rather
      // than off keeps some room sound, so the voice does not cut out
      param("floor", -25, -100, 0),
    ];
  }

  gain = 1;
  open = true;
  holdFrames = 0;
  reportFrames = 0;
  reportLevel = SILENCE_DB;

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const frames = output[0]?.length ?? 128;
    const threshold = parameters.threshold[0];
    const enabled = parameters.enabled[0] >= 0.5;
    const holdFrames = parameters.hold[0] * sampleRate;

    const first = input[0];
    let sum = 0;
    if (first)
      for (let i = 0; i < first.length; i++) sum += first[i] * first[i];
    const level = first?.length
      ? Math.max(SILENCE_DB, 10 * Math.log10(sum / first.length + 1e-12))
      : SILENCE_DB;

    if (!enabled || level >= threshold) {
      this.open = true;
      this.holdFrames = holdFrames;
    } else if (this.open && level >= threshold - parameters.hysteresis[0]) {
      this.holdFrames = holdFrames;
    } else {
      this.holdFrames -= frames;
      if (this.holdFrames <= 0) this.open = false;
    }

    const target = this.open ? 1 : 10 ** (parameters.floor[0] / 20);
    const seconds =
      target > this.gain ? parameters.attack[0] : parameters.release[0];
    const rate = 1 - Math.exp(-1 / (seconds * sampleRate));
    for (let i = 0; i < frames; i++) {
      this.gain += (target - this.gain) * rate;
      for (let c = 0; c < output.length; c++) {
        output[c][i] = (input[c] ?? first)?.[i] * this.gain || 0;
      }
    }

    this.reportLevel = Math.max(this.reportLevel, level);
    this.reportFrames += frames;
    if (this.reportFrames >= REPORT_SECONDS * sampleRate) {
      this.port.postMessage({ level: this.reportLevel, open: this.open });
      this.reportFrames = 0;
      this.reportLevel = SILENCE_DB;
    }
    return true;
  }
}

registerProcessor("element-call-mic-gate", MicGateProcessor);
