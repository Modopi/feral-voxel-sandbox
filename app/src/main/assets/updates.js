import { VERSION } from "./version.js";

// The update panel the launcher and the in-game menu share (docs/ARCHITECTURE.md §4).
const PANEL = `<div class="metricGrid">
  <div><span>게임 코드</span><b id="gameVersion">—</b></div>
  <div><span>Android 앱</span><b id="nativeVersion">—</b></div>
  <div><span>배포 채널</span><b>stable</b></div>
</div>
<h3 id="updateConnection">공개 GitHub 업데이트</h3>
<p id="updateMessage" role="status" aria-live="polite">업데이트 상태를 준비합니다.</p>
<label class="setting">실행할 때 자동 확인·다운로드 <input id="automaticUpdates" type="checkbox" checked /></label>
<div class="buttonRow">
  <button id="chooseGameVersion" class="secondary">게임 버전 선택</button><button id="connectUpdates" class="secondary">업데이트 안내</button>
  <button id="checkUpdates" class="secondary">지금 확인</button>
  <button id="retryFailedUpdate" class="secondary hidden">실패한 버전 다시 실행</button>
  <button id="applyUpdate" class="primary hidden">저장 후 적용</button>
</div>
<p class="updateHelp">새 버전은 다음 실행에 적용합니다. 연결되지 않아도 현재 버전으로 플레이할 수 있습니다.
  실패·중단된 버전은 게임 버전 목록에서 [재시도]를 골라 다시 검증 후 실행할 수 있습니다.</p>
<p class="updateHelp">최근 확인: <span id="updateLastCheck">아직 확인하지 않음</span></p>`;

// 공개 업데이트는 로그인 없이 사용. 구 네이티브 상태 응답도 읽을 수 있도록 유지.
// panel: where to build the panel when the page does not have one yet.
export function initUpdates({ beforeApply, panel = document.querySelector('[data-panel="updates"]') }) {
  const $ = (id) => document.getElementById(id);
  if (!$("gameVersion") && panel) panel.innerHTML = PANEL;
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
        "chooseGameVersion",
        "retryFailedUpdate",
      ])
        $(id).disabled = true;
      return;
    }
    try {
      const s = JSON.parse(bridge.updateStatus());
      $("nativeVersion").textContent = s.nativeVersion;
      const publicUpdates = s.publicUpdates === true;
      $("updateConnection").textContent = publicUpdates
        ? "공개 GitHub 업데이트 · 로그인 불필요"
        : s.configured
          ? "GitHub 연결됨"
          : "공개 업데이트를 사용하려면 앱 0.3.2 설치";
      $("updateMessage").textContent =
        s.message ||
        (s.pendingCode !== 0 && s.pendingCode !== s.runtimeCode
          ? `${s.pendingVersion} 준비 완료 · 다음 실행에 적용합니다.`
          : "저장된 버전으로 오프라인에서도 탐험할 수 있습니다.");
      const canRetry = s.blockedCode > 0 && s.blockedCode !== s.runtimeCode && typeof bridge.retryFailedUpdate === "function";
      $("retryFailedUpdate").classList.toggle("hidden", !canRetry);
      $("retryFailedUpdate").disabled = !!s.busy;
      $("retryFailedUpdate").textContent = s.failureReason === "interrupted" ? "중단된 버전 다시 실행" : "실패한 버전 다시 실행";
      $("automaticUpdates").checked = s.automatic;
      $("checkUpdates").disabled = s.busy || (!publicUpdates && !s.configured);
      $("connectUpdates").disabled = s.busy;
      $("chooseGameVersion").disabled = s.busy;
      $("connectUpdates").textContent = publicUpdates
        ? "업데이트 안내"
        : s.configured
          ? "GitHub 연결 관리"
          : "GitHub 연결";
      $("applyUpdate").disabled = !(
        s.pendingCode !== 0 && s.pendingCode !== s.runtimeCode
      );
      $("applyUpdate").classList.toggle(
        "hidden",
        !(s.pendingCode !== 0 && s.pendingCode !== s.runtimeCode),
      );
      if ($("updateBadge")) $("updateBadge").textContent =
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
  $("chooseGameVersion").onclick = () => bridge?.chooseVersions?.();
  $("connectUpdates").onclick = () => bridge?.configureUpdates?.();
  $("retryFailedUpdate").onclick = () => bridge?.retryFailedUpdate?.();
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
