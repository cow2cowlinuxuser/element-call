/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Root as Form, Tooltip } from "@vector-im/compound-web";
import { AdvancedSettingsIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { Modal } from "../Modal";
import { MicProcessingSettings } from "../settings/MicProcessingSettings";
import { MicTuningSettings } from "../settings/MicTuningSettings";
import styles from "../settings/MicProcessingSettings.module.css";
import { micProcessing, useSetting } from "../settings/settings";
import { micProcessingFrom, needsMicProcessing } from "../state/MicProcessing";

interface Props {
  size?: "md" | "lg";
}

/**
 * Opens the voice processing controls straight from the call, and shows
 * whether any of them is on.
 */
export const VoiceProcessingButton: FC<Props> = ({ size }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [stored] = useSetting(micProcessing);
  const active = useMemo(
    () => needsMicProcessing(micProcessingFrom(stored)),
    [stored],
  );
  const label = t("settings.audio_tab.voice_processing_header");

  return (
    <>
      <Tooltip label={label}>
        <Button
          iconOnly
          Icon={AdvancedSettingsIcon}
          kind={active ? "primary" : "secondary"}
          size={size}
          aria-label={label}
          onClick={(): void => setOpen(true)}
          data-testid="incall_voice_processing"
        />
      </Tooltip>
      <Modal title={label} open={open} onDismiss={(): void => setOpen(false)}>
        <Form>
          <MicProcessingSettings showHeader={false} />
          <details className={styles.advanced}>
            <summary>{t("settings.mic_tuning.title")}</summary>
            <MicTuningSettings />
          </details>
        </Form>
      </Modal>
    </>
  );
};
