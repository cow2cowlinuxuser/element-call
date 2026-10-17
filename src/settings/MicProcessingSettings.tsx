/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@vector-im/compound-web";
import classNames from "classnames";

import { micProcessing as micProcessingSetting, useSetting } from "./settings";
import {
  defaultMicProcessing,
  GATE_THRESHOLD_MAX_DB,
  GATE_THRESHOLD_MIN_DB,
  type MicProcessing,
  micProcessingFrom,
  updateMicProcessing,
} from "../state/MicProcessing";
import {
  activeMicProcessor$,
  micLevelWanted$,
  type MicProcessor,
} from "../livekit/MicProcessor";
import { FieldRow, InputField } from "../input/Input";
import { Slider } from "../Slider";
import { EqualiserBand } from "../tile/PeerAudioMenuItems";
import { useBehavior } from "../useBehavior";
import styles from "./MicProcessingSettings.module.css";

const METER_FLOOR_DB = -80;

interface Props {
  /** Off where something around the settings already names them. */
  showHeader?: boolean;
}

/**
 * Settings for shaping the user's own microphone before others hear it.
 */
export const MicProcessingSettings: FC<Props> = ({ showHeader = true }) => {
  const { t } = useTranslation();
  const [stored] = useSetting(micProcessingSetting);
  const mic = useMemo(() => micProcessingFrom(stored), [stored]);
  const processor = useBehavior(activeMicProcessor$);

  // The level meter needs the processor running during a call
  useEffect(() => {
    micLevelWanted$.next(true);
    return (): void => micLevelWanted$.next(false);
  }, []);

  const formatThreshold = useCallback(
    (threshold: number): string =>
      t("settings.audio_tab.gate_threshold_value", { threshold }),
    [t],
  );
  const onThresholdChange = useCallback(
    (gateThreshold: number) => updateMicProcessing({ gateThreshold }),
    [],
  );
  const onBassChange = useCallback(
    (bass: number) => updateMicProcessing({ bass }),
    [],
  );
  const onMidChange = useCallback(
    (mid: number) => updateMicProcessing({ mid }),
    [],
  );
  const onTrebleChange = useCallback(
    (treble: number) => updateMicProcessing({ treble }),
    [],
  );

  return (
    <>
      {showHeader && <h4>{t("settings.audio_tab.voice_processing_header")}</h4>}
      <p>{t("settings.audio_tab.voice_processing_description")}</p>
      <FieldRow>
        <InputField
          id="micProcessingEnabled"
          type="checkbox"
          label={t("settings.audio_tab.voice_processing_enabled_label")}
          description={t(
            "settings.audio_tab.voice_processing_enabled_description",
          )}
          checked={mic.enabled}
          onChange={(e): void =>
            updateMicProcessing({ enabled: e.target.checked })
          }
        />
      </FieldRow>
      <FieldRow>
        <InputField
          id="micNoiseReduction"
          type="checkbox"
          label={t("settings.audio_tab.noise_reduction_label")}
          description={t("settings.audio_tab.noise_reduction_description")}
          disabled={!mic.enabled}
          checked={mic.noiseReduction}
          onChange={(e): void =>
            updateMicProcessing({ noiseReduction: e.target.checked })
          }
        />
      </FieldRow>
      <FieldRow>
        <InputField
          id="micNoiseGate"
          type="checkbox"
          label={t("settings.audio_tab.noise_gate_label")}
          description={t("settings.audio_tab.noise_gate_description")}
          disabled={!mic.enabled}
          checked={mic.gate}
          onChange={(e): void =>
            updateMicProcessing({ gate: e.target.checked })
          }
        />
      </FieldRow>
      <div className={styles.control}>
        <label>
          {t("settings.audio_tab.gate_threshold_label")}
          {": "}
          <span className={styles.value}>
            {formatThreshold(mic.gateThreshold)}
          </span>
        </label>
        <Slider
          label={t("settings.audio_tab.gate_threshold_label")}
          value={mic.gateThreshold}
          onValueChange={onThresholdChange}
          min={GATE_THRESHOLD_MIN_DB}
          max={GATE_THRESHOLD_MAX_DB}
          step={1}
          disabled={!mic.enabled || !mic.gate}
          tooltipFormatter={formatThreshold}
        />
      </div>
      {!mic.enabled ? (
        <p>{t("settings.audio_tab.voice_processing_off")}</p>
      ) : processor ? (
        <ActiveProcessorControls processor={processor} mic={mic} />
      ) : (
        <p>{t("settings.audio_tab.mic_level_outside_call")}</p>
      )}
      <div className={styles.control}>
        <label>{t("settings.audio_tab.voice_equaliser_label")}</label>
        <div className={styles.equaliser}>
          <EqualiserBand
            label={t("video_tile.bass")}
            value={mic.bass}
            onChange={onBassChange}
            disabled={!mic.enabled}
          />
          <EqualiserBand
            label={t("video_tile.mid")}
            value={mic.mid}
            onChange={onMidChange}
            disabled={!mic.enabled}
          />
          <EqualiserBand
            label={t("video_tile.treble")}
            value={mic.treble}
            onChange={onTrebleChange}
            disabled={!mic.enabled}
          />
        </div>
      </div>
      <Button
        kind="secondary"
        size="md"
        onClick={(e): void => {
          e.preventDefault();
          updateMicProcessing(defaultMicProcessing);
        }}
      >
        {t("settings.audio_tab.reset_voice_processing")}
      </Button>
    </>
  );
};

interface ActiveProcessorControlsProps {
  processor: MicProcessor;
  mic: MicProcessing;
}

const ActiveProcessorControls: FC<ActiveProcessorControlsProps> = ({
  processor,
  mic,
}) => {
  const { t } = useTranslation();
  const level = useBehavior(processor.level$);
  const monitoring = useBehavior(processor.monitoring$);
  const unavailable = useBehavior(processor.unavailable$);

  // Hearing yourself is for tuning, and should not outlast the settings
  useEffect(() => (): void => processor.setMonitoring(false), [processor]);

  return (
    <>
      {mic.noiseReduction && unavailable.noiseReduction && (
        <p className={styles.problem}>
          {t("settings.audio_tab.noise_reduction_unavailable")}
        </p>
      )}
      {unavailable.gate ? (
        <p className={styles.problem}>
          {t("settings.audio_tab.noise_gate_unavailable")}
        </p>
      ) : (
        <div className={styles.control}>
          <label id="micLevelLabel">
            {t("settings.audio_tab.mic_level_label")}
          </label>
          <MicLevelMeter
            level={level?.level ?? METER_FLOOR_DB}
            open={level?.open ?? true}
            threshold={mic.gate ? mic.gateThreshold : undefined}
          />
        </div>
      )}
      <FieldRow>
        <InputField
          id="micMonitor"
          type="checkbox"
          label={t("settings.audio_tab.monitor_label")}
          description={t("settings.audio_tab.monitor_description")}
          checked={monitoring}
          onChange={(e): void => processor.setMonitoring(e.target.checked)}
        />
      </FieldRow>
    </>
  );
};

interface MicLevelMeterProps {
  level: number;
  open: boolean;
  /** Shown as a marker while the gate is on. */
  threshold?: number;
}

const MicLevelMeter: FC<MicLevelMeterProps> = ({ level, open, threshold }) => {
  const { t } = useTranslation();
  const rounded = Math.round(Math.max(METER_FLOOR_DB, level));
  return (
    <div
      className={styles.meter}
      role="meter"
      aria-labelledby="micLevelLabel"
      aria-valuemin={METER_FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={rounded}
      aria-valuetext={t(
        open
          ? "settings.audio_tab.mic_level_open"
          : "settings.audio_tab.mic_level_closed",
        { level: rounded },
      )}
    >
      <div
        className={classNames(styles.meterFill, { [styles.closed]: !open })}
        style={{ inlineSize: `${meterPosition(level)}%` }}
      />
      {threshold !== undefined && (
        <div
          className={styles.meterThreshold}
          style={{ insetInlineStart: `${meterPosition(threshold)}%` }}
        />
      )}
    </div>
  );
};

function meterPosition(db: number): number {
  return Math.min(
    100,
    Math.max(0, ((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100),
  );
}
