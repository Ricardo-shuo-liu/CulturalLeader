// Fay「通用动作语义」到 Live2D 动作/表情的映射。
// 服务端只下发 code/behavior/affect（见 Fay/docs/Fay侧标准动作改造说明.md），
// 具体动作编号由前端配置表决定，因此换模型不需要改服务端。

export const DEFAULT_ACTIONS = {
  greeting: { motion: 'greet', expression: 'happy' },
  'guidance.invite': { motion: 'speak', expression: 'happy' },
  'speak.explain': { motion: 'speak', expression: 'neutral' },
};

export function resolveAction(config, action) {
  if (!action) return null;
  const table = { ...DEFAULT_ACTIONS, ...(config?.actions || {}) };
  const byCode = table[action.code];
  if (byCode) return byCode;
  const byBehavior = table[action.behavior];
  if (byBehavior) return byBehavior;
  // affect 兜底：warm → 开心，其余中性
  return { motion: action.affect === 'warm' ? 'speak' : null, expression: action.affect === 'warm' ? 'happy' : 'neutral' };
}
