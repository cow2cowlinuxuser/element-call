/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@vector-im/compound-web";

import {
  micProcessing as micProcessingSetting,
  micTuning as micTuningSetting,
  useSetting,
} from "./settings";
import {
  activeMicProcessor$,
  defaultMicTuning,
  type MicProcessor,
} from "../livekit/MicProcessor";
import {
  formatTuning,
  getTuning,
  micTuningGroups,
  setTuning,
  type TuningField,
} from "../livekit/micTuningFields";
import {
  getMicTuning,
  micTuningFrom,
  updateMicTuning,
  voiceSettingsFrom,
} from "../state/MicTuning";
import { micProcessingFrom, updateMicProcessing } from "../state/MicProcessing";
import { FieldRow, InputField } from "../input/Input";
import { Slider } from "../Slider";
import { useBehavior } from "../useBehavior";
import styles from "./MicProcessingSettings.module.css";

const LIMITER_READING_INTERVAL_MS = 100;

/**
 * The inner workings of the microphone processing, for fine tuning while
 * talking. The same controls as the audio lab's (see `audio-lab/`).
 */
export const MicTuningSettings: FC = () => {
  const { t } = useTranslation();
  const [stored] = useSetting(micTuningSetting);
  const tuning = useMemo(() => micTuningFrom(stored), [stored]);
  const processor = useBehavior(activeMicProcessor$);

  return (
    <>
      <p>{t("settings.mic_tuning.description")}</p>
      <FieldRow>
        <InputField
          id="micTuningHeadroom"
          type="checkbox"
          label={t("settings.mic_tuning.headroom_label")}
          description={t("settings.mic_tuning.headroom_description")}
          checked={tuning.headroom}
          onChange={(e): void =>
            updateMicTuning({ ...getMicTuning(), headroom: e.target.checked })
          }
        />
      </FieldRow>
      {processor && <LimiterReading processor={processor} />}
      {micTuningGroups.map((group) => (
        <section key={group.id} className={styles.tuningGroup}>
          <h5>{group.title(t)}</h5>
          {group.description && (
            <p className={styles.hint}>{group.description(t)}</p>
          )}
          {group.fields.map((field) => (
            <TuningSlider
              key={field.path.join(".")}
              field={field}
              value={getTuning(tuning, field.path)}
            />
          ))}
        </section>
      ))}
      <Button
        kind="secondary"
        size="md"
        onClick={(e): void => {
          e.preventDefault();
          updateMicTuning(defaultMicTuning);
        }}
      >
        {t("settings.mic_tuning.reset")}
      </Button>
      <VoiceSettingsTransfer />
    </>
  );
};

const TuningSlider: FC<{ field: TuningField; value: number }> = ({
  field,
  value,
}) => {
  const { t } = useTranslation();
  const format = useCallback(
    (v: number): string => formatTuning(t, field, v),
    [t, field],
  );
  const onChange = useCallback(
    (v: number): void =>
      updateMicTuning(setTuning(getMicTuning(), field.path, v)),
    [field],
  );
  const label = field.label(t);
  return (
    <div className={styles.control}>
      <label>
        {label}
        {": "}
        <span className={styles.value}>{format(value)}</span>
      </label>
      <Slider
        label={label}
        value={value}
        onValueChange={onChange}
        min={field.min}
        max={field.max}
        step={field.step}
        tooltipFormatter={format}
      />
    </div>
  );
};

const LimiterReading: FC<{ processor: MicProcessor }> = ({ processor }) => {
  const { t } = useTranslation();
  const [reduction, setReduction] = useState(0);
  useEffect(() => {
    const interval = setInterval(
      () => setReduction(processor.limiterReduction),
      LIMITER_READING_INTERVAL_MS,
    );
    return (): void => clearInterval(interval);
  }, [processor]);
  return (
    <p className={styles.hint}>
      {t("settings.mic_tuning.limiter_reduction", {
        value: Math.round(reduction * 10) / 10 || 0,
      })}
    </p>
  );
};

/** Copies and pastes voice settings, including those from the audio lab. */
const VoiceSettingsTransfer: FC = () => {
  const { t } = useTranslation();
  const [storedMic] = useSetting(micProcessingSetting);
  const [storedTuning] = useSetting(micTuningSetting);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const copy = async (): Promise<void> => {
    const json = JSON.stringify(
      {
        settings: micProcessingFrom(storedMic),
        tuning: micTuningFrom(storedTuning),
      },
      null,
      2,
    );
    setText(json);
    try {
      await navigator.clipboard.writeText(json);
      setStatus(t("settings.mic_tuning.copied"));
    } catch {
      setStatus(t("settings.mic_tuning.copy_failed"));
    }
  };

  const apply = (): void => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      setStatus(t("settings.mic_tuning.invalid"));
      return;
    }
    const { settings, tuning } = voiceSettingsFrom(value);
    updateMicProcessing(settings);
    updateMicTuning(tuning);
    setStatus(t("settings.mic_tuning.applied"));
  };

  return (
    <div className={styles.control}>
      <label htmlFor="micTuningTransfer">
        {t("settings.mic_tuning.transfer_label")}
      </label>
      <textarea
        id="micTuningTransfer"
        className={styles.transfer}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        spellCheck={false}
      />
      <div className={styles.buttons}>
        <Button
          kind="secondary"
          size="md"
          onClick={(e): void => {
            e.preventDefault();
            void copy();
          }}
        >
          {t("settings.mic_tuning.copy")}
        </Button>
        <Button
          kind="secondary"
          size="md"
          disabled={!text.trim()}
          onClick={(e): void => {
            e.preventDefault();
            apply();
          }}
        >
          {t("settings.mic_tuning.apply")}
        </Button>
      </div>
      {status && (
        <p className={styles.hint} role="status">
          {status}
        </p>
      )}
    </div>
  );
};
