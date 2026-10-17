/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type ChangeEvent,
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { BehaviorSubject } from "rxjs";

import { LabEngine, type ListenTo, type MicOptions, record } from "./LabEngine";
import {
  defaultLabState,
  type LabState,
  loadLabState,
  parseLabState,
  saveLabState,
} from "./labState";
import { holdPeak, measure, type Measurement, SILENCE_DB } from "./meters";
import { drawSpectrum } from "./spectrum";
import { Meter } from "./Meter";
import {
  type MicLevel,
  type MicProcessorUnavailable,
  type MicTuning,
} from "../src/livekit/MicProcessor";
import {
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  type MicProcessing,
} from "../src/state/MicProcessing";
import { EQ_RANGE_DB, type PeerAudio } from "../src/state/PeerAudio";
import {
  formatTuning,
  getTuning,
  micTuningGroups,
  setTuning,
} from "../src/livekit/micTuningFields";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

const Slider: FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  format = String,
  disabled,
  onChange,
}) => {
  const id = useId();
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
};

const Checkbox: FC<{
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, disabled, onChange }) => (
  <label className="checkbox">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    {label}
  </label>
);

const Section: FC<{ title: string; children: ReactNode }> = ({
  title,
  children,
}) => (
  <section>
    <h2>{title}</h2>
    {children}
  </section>
);

const db = (value: number): string => {
  const rounded = Math.round(value * 10) / 10 || 0;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} dB`;
};
const plain = (value: number): string => value.toFixed(2);

interface Readings {
  raw: Measurement & { heldDb: number; clips: number };
  processed: Measurement & { heldDb: number; clips: number };
  limiterReduction: number;
}

const emptyMeasurement = {
  peakDb: SILENCE_DB,
  rmsDb: SILENCE_DB,
  clipped: 0,
  heldDb: SILENCE_DB,
  clips: 0,
};
const emptyReadings: Readings = {
  raw: emptyMeasurement,
  processed: emptyMeasurement,
  limiterReduction: 0,
};

const READINGS_INTERVAL_MS = 60;

/**
 * A test bench for the microphone processing Element Call applies before your
 * voice is sent, using the very same code.
 */
export const AudioLab: FC = () => {
  const { t } = useTranslation();
  const [lab, setLab] = useState<LabState>(() => loadLabState(localStorage));
  const [settings$] = useState(
    () => new BehaviorSubject<MicProcessing>(lab.settings),
  );
  const [tuning$] = useState(() => new BehaviorSubject<MicTuning>(lab.tuning));
  useEffect(() => {
    saveLabState(localStorage, lab);
    settings$.next(lab.settings);
    tuning$.next(lab.tuning);
  }, [lab, settings$, tuning$]);

  const updateSettings = (changes: Partial<MicProcessing>): void =>
    setLab((l) => ({ ...l, settings: { ...l.settings, ...changes } }));
  const updateListener = (changes: Partial<PeerAudio>): void =>
    setLab((l) => ({ ...l, listener: { ...l.listener, ...changes } }));

  const [engine, setEngine] = useState<LabEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<"mic" | "file">("mic");
  const [file, setFile] = useState<File | null>(null);
  const [mic, setMic] = useState<MicOptions>({
    deviceId: "",
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  });
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputId, setOutputId] = useState("");
  const [listenTo, setListenTo] = useState<ListenTo>("off");
  const [level, setLevel] = useState<MicLevel | null>(null);
  const [unavailable, setUnavailable] = useState<MicProcessorUnavailable>({
    noiseReduction: false,
    gate: false,
  });
  const [readings, setReadings] = useState<Readings>(emptyReadings);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const refreshDevices = useCallback(async (): Promise<void> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setInputs(devices.filter((d) => d.kind === "audioinput"));
    setOutputs(devices.filter((d) => d.kind === "audiooutput"));
  }, []);
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const connectSource = useCallback(
    async (target: LabEngine): Promise<void> => {
      setError(null);
      try {
        if (sourceKind === "file") {
          if (!file) throw new Error("Choose an audio file first");
          await target.useFile(file);
        } else {
          await target.useMic(mic);
          await refreshDevices();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [sourceKind, file, mic, refreshDevices],
  );

  const start = async (): Promise<void> => {
    const created = new LabEngine(settings$, tuning$);
    setEngine(created);
    await connectSource(created);
  };
  const stop = (): void => {
    setEngine(null);
    setReadings(emptyReadings);
  };

  useEffect(() => {
    if (!engine) return;
    const subscriptions = [
      engine.processor.level$.subscribe(setLevel),
      engine.processor.unavailable$.subscribe(setUnavailable),
    ];
    return (): void => subscriptions.forEach((s) => s.unsubscribe());
  }, [engine]);
  useEffect(() => () => void engine?.destroy(), [engine]);

  useEffect(() => engine?.setListenTo(listenTo), [engine, listenTo]);
  useEffect(
    () => engine?.setListener(lab.listener, lab.tuning),
    [engine, lab.listener, lab.tuning],
  );
  useEffect(() => {
    if (engine && outputId)
      engine.setOutputDevice(outputId).catch((e) => setError(String(e)));
  }, [engine, outputId]);

  // Meters and spectrum
  useEffect(() => {
    if (!engine) return;
    const raw = new Float32Array(engine.rawAnalyser.fftSize);
    const processed = new Float32Array(engine.processedAnalyser.fftSize);
    const rawSpectrum = new Float32Array(engine.rawAnalyser.frequencyBinCount);
    const processedSpectrum = new Float32Array(
      engine.processedAnalyser.frequencyBinCount,
    );
    let frame = 0;
    let last = performance.now();
    let lastReport = 0;
    let current = emptyReadings;
    const tick = (now: number): void => {
      const elapsed = (now - last) / 1000;
      last = now;
      engine.rawAnalyser.getFloatTimeDomainData(raw);
      engine.processedAnalyser.getFloatTimeDomainData(processed);
      const update = (
        previous: Readings["raw"],
        samples: Float32Array,
      ): Readings["raw"] => {
        const m = measure(samples);
        return {
          ...m,
          heldDb: holdPeak(previous.heldDb, m.peakDb, elapsed),
          clips: previous.clips + m.clipped,
        };
      };
      current = {
        raw: update(current.raw, raw),
        processed: update(current.processed, processed),
        limiterReduction: Math.min(
          current.limiterReduction,
          engine.processor.limiterReduction,
        ),
      };
      if (now - lastReport > READINGS_INTERVAL_MS) {
        lastReport = now;
        setReadings(current);
        current = {
          ...current,
          limiterReduction: engine.processor.limiterReduction,
        };
      }

      const canvas = canvasRef.current;
      if (canvas) {
        engine.rawAnalyser.getFloatFrequencyData(rawSpectrum);
        engine.processedAnalyser.getFloatFrequencyData(processedSpectrum);
        drawSpectrum(canvas, engine.context.sampleRate, [
          { data: rawSpectrum, colour: "rgba(160, 160, 160, 0.9)" },
          { data: processedSpectrum, colour: "rgba(13, 189, 139, 1)" },
        ]);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return (): void => cancelAnimationFrame(frame);
  }, [engine]);

  const resetClips = (): void =>
    setReadings((r) => ({
      ...r,
      raw: { ...r.raw, clips: 0 },
      processed: { ...r.processed, clips: 0 },
    }));

  // Recording
  const [recording, setRecording] = useState<{
    stop: () => Promise<void>;
  } | null>(null);
  const [clips, setClips] = useState<{ raw: string; processed: string } | null>(
    null,
  );
  const startRecording = (): void => {
    if (!engine?.rawTrack || !engine.processedTrack) return;
    const raw = record(engine.rawTrack);
    const processed = record(engine.processedTrack);
    setRecording({
      stop: async (): Promise<void> => {
        const [rawBlob, processedBlob] = await Promise.all([
          raw.stop(),
          processed.stop(),
        ]);
        setClips((old) => {
          if (old) {
            URL.revokeObjectURL(old.raw);
            URL.revokeObjectURL(old.processed);
          }
          return {
            raw: URL.createObjectURL(rawBlob),
            processed: URL.createObjectURL(processedBlob),
          };
        });
      },
    });
  };
  const stopRecording = async (): Promise<void> => {
    const current = recording;
    setRecording(null);
    await current?.stop();
  };

  // Import and export
  const [exported, setExported] = useState("");
  const exportState = (): void => setExported(JSON.stringify(lab, null, 2));
  const importState = (): void => {
    try {
      setLab(parseLabState(exported));
      setError(null);
    } catch (e) {
      setError(`Could not read the settings: ${String(e)}`);
    }
  };
  const copyState = async (): Promise<void> => {
    const json = JSON.stringify(lab, null, 2);
    setExported(json);
    await navigator.clipboard.writeText(json);
  };

  const { settings, tuning, listener } = lab;

  return (
    <main>
      <header>
        <h1>Element Call audio lab</h1>
        <p>
          Your voice goes through the same processing Element Call uses before
          it is sent. Change things here, listen, then copy the settings back.
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="columns">
        <div>
          <Section title="Source">
            <div className="row">
              <label className="checkbox">
                <input
                  type="radio"
                  name="source"
                  checked={sourceKind === "mic"}
                  onChange={() => setSourceKind("mic")}
                />
                Microphone
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name="source"
                  checked={sourceKind === "file"}
                  onChange={() => setSourceKind("file")}
                />
                Audio file (looped)
              </label>
            </div>
            {sourceKind === "mic" ? (
              <>
                <label className="field">
                  Input device
                  <select
                    value={mic.deviceId}
                    onChange={(e) =>
                      setMic({ ...mic, deviceId: e.target.value })
                    }
                  >
                    <option value="">Default</option>
                    {inputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || d.deviceId}
                      </option>
                    ))}
                  </select>
                </label>
                <Checkbox
                  label="Browser echo cancellation"
                  checked={mic.echoCancellation}
                  onChange={(echoCancellation) =>
                    setMic({ ...mic, echoCancellation })
                  }
                />
                <Checkbox
                  label="Browser noise suppression"
                  checked={mic.noiseSuppression}
                  onChange={(noiseSuppression) =>
                    setMic({ ...mic, noiseSuppression })
                  }
                />
                <p className="hint">
                  Element turns this off while noise reduction is on.
                </p>
                <Checkbox
                  label="Browser automatic gain"
                  checked={mic.autoGainControl}
                  onChange={(autoGainControl) =>
                    setMic({ ...mic, autoGainControl })
                  }
                />
              </>
            ) : (
              <label className="field">
                Audio file
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setFile(e.target.files?.[0] ?? null)
                  }
                />
              </label>
            )}
            <div className="row">
              {engine ? (
                <>
                  <button onClick={() => void connectSource(engine)}>
                    Apply source
                  </button>
                  <button onClick={stop}>Stop</button>
                </>
              ) : (
                <button className="primary" onClick={() => void start()}>
                  Start
                </button>
              )}
            </div>
          </Section>

          <Section title="Voice processing (what users set)">
            <Checkbox
              label="Noise reduction (RNNoise)"
              checked={settings.noiseReduction}
              onChange={(noiseReduction) => updateSettings({ noiseReduction })}
            />
            {unavailable.noiseReduction && (
              <p className="error">Noise reduction failed to start.</p>
            )}
            <Checkbox
              label="Noise gate"
              checked={settings.gate}
              onChange={(gate) => updateSettings({ gate })}
            />
            {unavailable.gate && (
              <p className="error">The noise gate failed to start.</p>
            )}
            <Slider
              label="Gate threshold"
              value={settings.gateThreshold}
              min={GATE_THRESHOLD_MIN_DB}
              max={GATE_THRESHOLD_MAX_DB}
              step={1}
              format={db}
              disabled={!settings.gate}
              onChange={(gateThreshold) => updateSettings({ gateThreshold })}
            />
            {(["bass", "mid", "treble"] as const).map((band) => (
              <Slider
                key={band}
                label={band[0].toUpperCase() + band.slice(1)}
                value={settings[band]}
                min={-EQ_RANGE_DB}
                max={EQ_RANGE_DB}
                step={1}
                format={db}
                onChange={(value) => updateSettings({ [band]: value })}
              />
            ))}
            <button
              onClick={() =>
                setLab((l) => ({ ...l, settings: defaultLabState.settings }))
              }
            >
              Reset voice processing
            </button>
          </Section>

          <Section title="Tuning (what ships in Element)">
            <Checkbox
              label="Make headroom for equaliser boosts"
              checked={tuning.headroom}
              onChange={(headroom) =>
                setLab((l) => ({ ...l, tuning: { ...l.tuning, headroom } }))
              }
            />
            {micTuningGroups.map((group) => (
              <fieldset key={group.id}>
                <legend>{group.title(t)}</legend>
                {group.description && (
                  <p className="hint">{group.description(t)}</p>
                )}
                {group.fields.map((field) => (
                  <Slider
                    key={field.path.join(".")}
                    label={field.label(t)}
                    value={getTuning(tuning, field.path)}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    format={(value) => formatTuning(t, field, value)}
                    onChange={(value) =>
                      setLab((l) => ({
                        ...l,
                        tuning: setTuning(l.tuning, field.path, value),
                      }))
                    }
                  />
                ))}
              </fieldset>
            ))}
            <button
              onClick={() =>
                setLab((l) => ({ ...l, tuning: defaultLabState.tuning }))
              }
            >
              Reset tuning to Element's
            </button>
          </Section>
        </div>

        <div>
          <Section title="Listen">
            <div className="row" role="radiogroup" aria-label="Listen to">
              {(["off", "raw", "processed"] as const).map((mode) => (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={listenTo === mode}
                  className={listenTo === mode ? "primary" : undefined}
                  onClick={() => setListenTo(mode)}
                >
                  {mode === "off"
                    ? "Off"
                    : mode === "raw"
                      ? "Raw"
                      : "Processed"}
                </button>
              ))}
              <button
                onClick={() =>
                  setListenTo(listenTo === "processed" ? "raw" : "processed")
                }
              >
                Swap A/B
              </button>
            </div>
            <p className="hint">
              Use headphones while listening to a microphone, or it will feed
              back.
            </p>
            {LabEngine.canChooseOutput && (
              <label className="field">
                Output device
                <select
                  value={outputId}
                  onChange={(e) => setOutputId(e.target.value)}
                >
                  <option value="">Default</option>
                  {outputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || d.deviceId}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <fieldset>
              <legend>The listener's settings for you</legend>
              <Slider
                label="Volume"
                value={listener.volume}
                min={0}
                max={2}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(volume) => updateListener({ volume })}
              />
              <Slider
                label="Pan"
                value={listener.pan}
                min={-1}
                max={1}
                step={0.01}
                format={plain}
                onChange={(pan) => updateListener({ pan })}
              />
              {(["bass", "mid", "treble"] as const).map((band) => (
                <Slider
                  key={band}
                  label={band[0].toUpperCase() + band.slice(1)}
                  value={listener[band]}
                  min={-EQ_RANGE_DB}
                  max={EQ_RANGE_DB}
                  step={1}
                  format={db}
                  onChange={(value) => updateListener({ [band]: value })}
                />
              ))}
            </fieldset>
          </Section>

          <Section title="Meters">
            <Meter label="Raw" reading={readings.raw} />
            <Meter label="Processed" reading={readings.processed} />
            <dl className="stats">
              <dt>Limiter reduction</dt>
              <dd>{db(readings.limiterReduction)}</dd>
              <dt>Gate</dt>
              <dd>
                {!settings.gate
                  ? "Off"
                  : level?.open
                    ? "Open"
                    : level
                      ? "Closed"
                      : "–"}
              </dd>
              <dt>Gate input level</dt>
              <dd>{level ? db(level.level) : "–"}</dd>
            </dl>
            <button onClick={resetClips}>Reset clip counts</button>
            <canvas
              ref={canvasRef}
              className="spectrum"
              width={640}
              height={220}
              aria-label="Spectrum: raw in grey, processed in green"
            />
            <p className="hint">Spectrum: raw in grey, processed in green.</p>
          </Section>

          <Section title="Record a take">
            <div className="row">
              {recording ? (
                <button onClick={() => void stopRecording()}>Stop</button>
              ) : (
                <button disabled={!engine} onClick={startRecording}>
                  Record raw and processed
                </button>
              )}
            </div>
            {clips && (
              <div className="clips">
                {(["raw", "processed"] as const).map((which) => (
                  <div key={which}>
                    <span>{which === "raw" ? "Raw" : "Processed"}</span>
                    <audio controls src={clips[which]}>
                      <track kind="captions" />
                    </audio>
                    <a href={clips[which]} download={`voice-${which}.webm`}>
                      Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Port back to Element">
            <p className="hint">
              The tuning becomes <code>defaultMicTuning</code> in{" "}
              <code>src/livekit/MicProcessor.ts</code>.
            </p>
            <div className="row">
              <button onClick={() => void copyState()}>Copy settings</button>
              <button onClick={exportState}>Show settings</button>
              <button disabled={!exported} onClick={importState}>
                Load pasted settings
              </button>
            </div>
            <textarea
              aria-label="Settings as JSON"
              value={exported}
              onChange={(e) => setExported(e.target.value)}
              rows={12}
              spellCheck={false}
            />
          </Section>
        </div>
      </div>
    </main>
  );
};
