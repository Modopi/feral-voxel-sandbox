import { VERSION } from "./version.js";

// 화면에는 연결 상태만 노출하며 토큰 입력과 보관은 Android에서 처리
export function initUpdates({ beforeApply }) {
  const $ = (id) => document.getElementById(id);
  const bridge = window.AndroidApp;
  const available = typeof bridge?.updateStatus === "function";
  let failed = false,
    acknowledged = false,
    renderedFrames = 0,
    readySince = 0;
  for (const el of document.querySelectorAll("[data-game-version]")) {
    el.textContent = `FERAL ${VERSION.version}`;
  }
  function refresh() {
    $("gameVersion").textContent = VERSION.version;
    if (!available) {
      $("nativeVersion").textContent = "웹 미리보기";
      $("updateMessage").textContent =
        "자동 업데이트는 Android 앱에서 사용할 수 있습니다.";
      for (const id of [
        "connectUpdates",
        "checkUpdates",
        "applyUpdate",
        "automaticUpdates",
      ])
        $(id).disabled = true;
      return;
    }
    try {
      const s = JSON.parse(bridge.updateStatus());
      $("nativeVersion").textContent = s.nativeVersion;
      $("updateConnection").textContent = s.configured
        ? "비공개 GitHub 연결됨"
        : "GitHub 연결 필요";
      $("updateMessage").textContent =
        s.message ||
        (s.pendingCode !== 0 && s.pendingCode !== s.runtimeCode
          ? `${s.pendingVersion} 준비 완료 · 다음 실행에 적용합니다.`
          : "저장된 버전으로 오프라인에서도 탐험할 수 있습니다.");
      $("automaticUpdates").checked = s.automatic;
      $("checkUpdates").disabled = s.busy || !s.configured;
      $("connectUpdates").disabled = s.busy;
      $("connectUpdates").textContent = s.configured
        ? "GitHub 연결 관리"
        : "GitHub 연결";
      $("applyUpdate").disabled = !(s.pendingCode !== 0 && s.pendingCode !== s.runtimeCode);
      $("applyUpdate").classList.toggle(
        "hidden",
        !(s.pendingCode !== 0 && s.pendingCode !== s.runtimeCode),
      );
      $("updateBadge").textContent =
        s.pendingCode !== 0 && s.pendingCode !== s.runtimeCode
          ? "준비됨"
          : `v${VERSION.version}`;
      $("updateLastCheck").textContent = s.lastCheck
        ? new Date(s.lastCheck).toLocaleString("ko-KR")
        : "아직 확인하지 않음";
    } catch {
      $("updateMessage").textContent =
        "업데이트 상태를 읽지 못했습니다. 탐험은 계속할 수 있습니다.";
    }
  }
  $("connectUpdates").onclick = () => bridge?.configureUpdates?.();
  $("checkUpdates").onclick = () => bridge?.checkUpdates?.();
  $("automaticUpdates").onchange = () =>
    bridge?.setAutoUpdates?.($("automaticUpdates").checked);
  $("applyUpdate").onclick = () => {
    if (beforeApply()) bridge?.applyUpdate?.();
    else
      $("updateMessage").textContent =
        "탐험을 저장하지 못해 적용을 미뤘습니다. 저장 공간을 확인해 주세요.";
  };
  refresh();
  return {
    refresh,
    failed() {
      failed = true;
      bridge?.runtimeFailed?.();
    },
    frame(ready, now) {
      if (failed || acknowledged || !ready || document.hidden) return;
      readySince ||= now;
      if (++renderedFrames >= 12 && now - readySince >= 3000) {
        acknowledged = true;
        bridge?.runtimeHealthy?.(VERSION.versionCode);
      }
    },
  };
}
