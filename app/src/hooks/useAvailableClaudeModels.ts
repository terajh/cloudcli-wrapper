import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { CLAUDE_MODELS } from '../../shared/modelConstants';

type ClaudeModelOption = {
  value: string;
  label: string;
};

type AvailableClaudeModelsState = {
  models: ClaudeModelOption[];
  loading: boolean;
  error: string | null;
};

/**
 * 서버의 `/api/claude/available-models` 엔드포인트를 호출해서
 * 사용자 계정으로 실제 사용 가능한 Claude 모델만 반환한다.
 * 네트워크 에러가 나면 정적인 CLAUDE_MODELS.OPTIONS 로 안전하게 폴백.
 *
 * 로딩 중에도 기본 리스트를 내려줘서 드롭다운이 비어있지 않도록 한다.
 */
export function useAvailableClaudeModels(): AvailableClaudeModelsState {
  const [state, setState] = useState<AvailableClaudeModelsState>({
    models: CLAUDE_MODELS.OPTIONS,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        const response = await api.availableClaudeModels();
        if (cancelled) return;

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const models: ClaudeModelOption[] = Array.isArray(payload?.models)
          ? payload.models
          : [];

        setState({
          models: models.length > 0 ? models : CLAUDE_MODELS.OPTIONS,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          models: CLAUDE_MODELS.OPTIONS,
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
