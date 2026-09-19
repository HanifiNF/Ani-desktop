import { useEffect, useState } from "react";
import type { UpdateInstallStatus } from "../shared/contracts";
import { messageFrom } from "./errors";

export function useUpdateInstall(onError: (message: string) => void) {
  const [status, setStatus] = useState<UpdateInstallStatus>();
  useEffect(() => {
    let active = true, receivedEvent = false;
    const unsubscribe = window.aniDesktop.onUpdateInstallStatus((value) => { receivedEvent = true; if (active) setStatus(value); });
    void window.aniDesktop.getUpdateInstallStatus().then((value) => {
      if (active && !receivedEvent) setStatus(value);
    }, (reason) => { if (active) onError(messageFrom(reason)); });
    return () => { active = false; unsubscribe(); };
  }, [onError]);
  return { status,
    download: (version: string) => { void window.aniDesktop.downloadUpdate(version).then(setStatus, (reason) => onError(messageFrom(reason))); },
    install: () => { void window.aniDesktop.installUpdate().catch((reason) => onError(messageFrom(reason))); }
  };
}
