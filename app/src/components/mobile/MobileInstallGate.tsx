import { ReactNode, useEffect, useState } from "react";
import { MobileInstallScreen } from "./MobileInstallScreen";
const LOCAL_STORAGE_KEY = "taedal_mobile_install_dismissed";

type MobileInstallGateProps = {
  children: ReactNode;
};

function isStandaloneMode() {
  // iOS Safari standalone
  const isIOSStandalone = (window.navigator as any).standalone === true;
  // Other browsers (display-mode: standalone)
  const isDisplayModeStandalone = window.matchMedia?.(
    "(display-mode: fullscreen), (display-mode: standalone)"
  ).matches;

  return isIOSStandalone || isDisplayModeStandalone;
}

function isLikelyMobileIOS() {
  const ua = window.navigator.userAgent || "";
  const isIPhone = /iPhone/i.test(ua);
  const isIPad = /iPad/i.test(ua);
  const isIOS = isIPhone || isIPad;

  // Very rough width check, just to avoid tiny desktop windows triggering this
  const isSmallScreen = window.innerWidth <= 900;

  // Safari detection (basic)
  const isSafari =
    /Safari/i.test(ua) &&
    !/Chrome/i.test(ua) &&
    !/CriOS/i.test(ua) &&
    !/FxiOS/i.test(ua);

  return isIOS && isSmallScreen && isSafari;
}

export function MobileInstallGate({ children }: MobileInstallGateProps) {
  const [showInstallScreen, setShowInstallScreen] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(LOCAL_STORAGE_KEY) === "1";

      if (dismissed) return;
      if (!isLikelyMobileIOS()) return;
      if (isStandaloneMode()) return;

      setShowInstallScreen(true);
    } catch {
      // If anything fails, just don’t block the app
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setShowInstallScreen(false);
  };

  if (showInstallScreen) {
    return <MobileInstallScreen onDismiss={handleDismiss} />;
  }

  return <>{children}</>;
}
