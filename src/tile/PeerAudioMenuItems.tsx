/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MenuItem } from "@vector-im/compound-web";
import {
  AudioIcon,
  HeadphonesSolidIcon,
  RestartIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { Slider } from "../Slider";
import { useBehavior } from "../useBehavior";
import { EQ_RANGE_DB } from "../state/PeerAudio";
import { type PeerAudioControls } from "../state/media/RemoteUserMediaViewModel";
import styles from "./PeerAudioMenuItems.module.css";

interface Props {
  vm: PeerAudioControls;
}

/**
 * Menu items for placing a member left or right and shaping their voice with a
 * three band equaliser.
 */
export const PeerAudioMenuItems: FC<Props> = ({ vm }) => {
  const { t } = useTranslation();
  const { pan, bass, mid, treble } = useBehavior(vm.peerAudio$);

  const onPanChange = useCallback(
    (value: number) => vm.adjustPeerAudio({ pan: value }),
    [vm],
  );
  const onBassChange = useCallback(
    (value: number) => vm.adjustPeerAudio({ bass: value }),
    [vm],
  );
  const onMidChange = useCallback(
    (value: number) => vm.adjustPeerAudio({ mid: value }),
    [vm],
  );
  const onTrebleChange = useCallback(
    (value: number) => vm.adjustPeerAudio({ treble: value }),
    [vm],
  );
  const formatPan = useCallback(
    (value: number): string => {
      const percent = Math.round(Math.abs(value) * 100);
      if (percent === 0) return t("video_tile.pan_centre");
      return value < 0
        ? t("video_tile.pan_left", { percent })
        : t("video_tile.pan_right", { percent });
    },
    [t],
  );

  return (
    <>
      <MenuItem
        as="div"
        Icon={HeadphonesSolidIcon}
        label={null}
        onSelect={null}
      >
        <Slider
          className={styles.slider}
          label={t("video_tile.pan")}
          value={pan}
          onValueChange={onPanChange}
          min={-1}
          max={1}
          step={0.05}
          tooltipFormatter={formatPan}
        />
      </MenuItem>
      <MenuItem as="div" Icon={AudioIcon} label={null} onSelect={null}>
        <div className={styles.equaliser}>
          <EqualiserBand
            label={t("video_tile.bass")}
            value={bass}
            onChange={onBassChange}
          />
          <EqualiserBand
            label={t("video_tile.mid")}
            value={mid}
            onChange={onMidChange}
          />
          <EqualiserBand
            label={t("video_tile.treble")}
            value={treble}
            onChange={onTrebleChange}
          />
        </div>
      </MenuItem>
      <MenuItem
        Icon={RestartIcon}
        label={t("video_tile.reset_audio")}
        onSelect={vm.resetPeerAudio}
      />
    </>
  );
};

interface EqualiserBandProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export const EqualiserBand: FC<EqualiserBandProps> = ({
  label,
  value,
  onChange,
  disabled,
}) => {
  const { t } = useTranslation();
  const formatGain = useCallback(
    (gain: number): string =>
      t("video_tile.equaliser_gain", {
        band: label,
        gain: gain > 0 ? `+${gain}` : `${gain}`,
      }),
    [t, label],
  );

  return (
    <div className={styles.band}>
      <span className={styles.bandLabel} aria-hidden>
        {label}
      </span>
      <Slider
        className={styles.slider}
        label={label}
        value={value}
        onValueChange={onChange}
        min={-EQ_RANGE_DB}
        max={EQ_RANGE_DB}
        step={1}
        disabled={disabled}
        tooltipFormatter={formatGain}
      />
    </div>
  );
};
