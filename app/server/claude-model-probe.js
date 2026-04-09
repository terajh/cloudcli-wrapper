/**
 * Claude Model Availability Probe
 *
 * 사용자 계정에서 실제로 사용 가능한 Claude 모델만 필터링해주는 모듈.
 * 일부 모델(예: sonnet[1m])은 계정에 "Extra usage" 권한이 필요해서
 * 구독자라도 사용할 수 없을 수 있다. UI 드롭다운에 사용 불가 모델이
 * 노출되면 사용자가 선택 후 빈 "Receiving" 상태에 갇히므로, 서버 부팅
 * 시점에 각 모델을 한 번씩 가볍게 probe 해서 캐시한 결과를 프론트에
 * 내려준다.
 *
 * Probe 방식: `claude --print --model X "."` 를 spawn 해서 exit code
 * 와 stderr 의 access-denied 패턴을 확인. TTL 30 분 동안 캐시.
 */

import { spawn } from 'child_process';
import { CLAUDE_MODELS } from '../shared/modelConstants.js';

const PROBE_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 30 * 60 * 1000;

// stderr 에 이 패턴이 있으면 "접근 불가" 로 간주하고 리스트에서 제외.
// (일시적 네트워크/rate-limit 등은 false positive 방지를 위해 available 로 둔다)
const ACCESS_DENIED_PATTERNS = [
  /extra usage is required/i,
  /enable extra usage/i,
  /upgrade.*required/i,
  /not available.*account/i,
  /access denied/i,
  /not.*subscribed/i,
];

let cacheEntry = null;

function isAccessDenied(stderr) {
  const text = stderr || '';
  return ACCESS_DENIED_PATTERNS.some((regex) => regex.test(text));
}

function probeSingleModel(modelId) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    // NOTE: `claude --print` writes API errors (including "Extra usage is required")
    // to STDOUT, not stderr. We need to capture both streams to detect access-denied
    // responses correctly.
    const child = spawn('claude', ['--print', '--model', modelId, '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      // Timeout -> 판단 불가. 사용자가 고를 수 있도록 available 로 둔다.
      resolve({ modelId, available: true, reason: 'timeout' });
    }, PROBE_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.log(`[claude-model-probe] ${modelId} spawn-error: ${err?.message || err}`);
      // spawn 실패(claude binary 없음 등) -> 전체 probe 가 실패할 테니
      // 일단 available 로 둬서 기존 동작 유지.
      resolve({ modelId, available: true, reason: 'spawn-error' });
    });

    child.on('exit', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const combinedOutput = `${stdout}\n${stderr}`;
      console.log(
        `[claude-model-probe] ${modelId} exit=${code} output(first 200)="${combinedOutput.trim().slice(0, 200)}"`,
      );

      if (code === 0) {
        resolve({ modelId, available: true, reason: 'ok' });
        return;
      }

      if (isAccessDenied(combinedOutput)) {
        resolve({
          modelId,
          available: false,
          reason: 'access-denied',
          output: combinedOutput.trim().slice(0, 300),
        });
        return;
      }

      // 기타 에러(네트워크, rate limit 등)는 일시적일 가능성이 있으니
      // 기본 available 유지. 사용자가 실제 사용 시점에 제대로 된 에러를 보게 된다.
      resolve({
        modelId,
        available: true,
        reason: 'non-access-error',
        output: combinedOutput.trim().slice(0, 300),
      });
    });
  });
}

/**
 * 모든 Claude 모델을 병렬 probe 해서 사용 가능한 모델 리스트를 반환한다.
 * 결과는 30 분간 캐시된다. 강제 refresh 는 `force` 옵션 사용.
 *
 * @param {{ force?: boolean }} options
 * @returns {Promise<Array<{ value: string, label: string }>>}
 */
export async function getAvailableClaudeModels({ force = false } = {}) {
  const now = Date.now();
  if (!force && cacheEntry && now - cacheEntry.at < CACHE_TTL_MS) {
    return cacheEntry.models;
  }

  const options = CLAUDE_MODELS.OPTIONS;
  const probes = await Promise.all(options.map((opt) => probeSingleModel(opt.value)));

  const availableValues = new Set(
    probes.filter((probe) => probe.available).map((probe) => probe.modelId),
  );

  const filtered = options.filter((opt) => availableValues.has(opt.value));
  const unavailable = probes.filter((probe) => !probe.available);
  if (unavailable.length > 0) {
    console.log(
      '[claude-model-probe] Hiding unavailable models:',
      unavailable.map((probe) => `${probe.modelId}(${probe.reason})`).join(', '),
    );
  }

  cacheEntry = { at: now, models: filtered };
  return filtered;
}
