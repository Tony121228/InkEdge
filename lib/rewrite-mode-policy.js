const EMPTY_ANCHORS = {
  timeExpressions: [],
  persons: [],
  places: [],
  objects: [],
  actions: [],
  quantities: [],
  feelings: [],
  sensoryDetails: []
};

const POLICIES = {
  aggressive: {
    rewriteMode: 'aggressive',
    safetyMode: 'off',
    buildFactInventory: false,
    protectFactsInPlan: false,
    promptFactBoundary: 'off',
    auditMode: 'off',
    factAuditEnabled: false,
    factAuditSeverity: 'off',
    factAuditBlocking: false,
    factAuditCanRepair: false,
    factAuditCanFallback: false,
    modelFailureCanFallback: true,
    displayFactAudit: false,
    displayFactInventory: false,
    candidateAcceptance: 'model_output'
  },
  balanced: {
    rewriteMode: 'balanced',
    safetyMode: 'balanced',
    buildFactInventory: true,
    protectFactsInPlan: true,
    promptFactBoundary: 'soft',
    auditMode: 'balanced',
    factAuditEnabled: true,
    factAuditSeverity: 'warning',
    factAuditBlocking: false,
    factAuditCanRepair: true,
    factAuditCanFallback: false,
    modelFailureCanFallback: true,
    displayFactAudit: true,
    displayFactInventory: true,
    candidateAcceptance: 'warnings_allowed'
  },
  conservative: {
    rewriteMode: 'conservative',
    safetyMode: 'strict',
    buildFactInventory: true,
    protectFactsInPlan: true,
    promptFactBoundary: 'strict',
    auditMode: 'strict',
    factAuditEnabled: true,
    factAuditSeverity: 'blocking',
    factAuditBlocking: true,
    factAuditCanRepair: true,
    factAuditCanFallback: true,
    modelFailureCanFallback: true,
    displayFactAudit: true,
    displayFactInventory: true,
    candidateAcceptance: 'strict_or_relaxed'
  }
};

function getRewriteModePolicy(mode = 'balanced') {
  return POLICIES[String(mode || '').trim()] || POLICIES.balanced;
}

function buildDisabledFactInventory(originalText = '') {
  return {
    topic: '',
    entities: [],
    events: [],
    observations: [],
    feelings: [],
    judgments: [],
    anchors: { ...EMPTY_ANCHORS },
    sourceBoundary: '',
    disabled: true,
    disabledReason: '强力模式不构建事实库存；模型候选只做长度、空结果、内部字段泄漏和 AI 风险复评。',
    forbiddenByAbsence: {
      allowNewTimeSpan: true,
      allowNewPerson: true,
      allowNewPlace: true,
      allowNewAction: true,
      allowNewObject: true,
      allowNewQuantity: true,
      allowNewFeeling: true,
      allowNewSensoryDetail: true
    },
    originalLength: String(originalText || '').length
  };
}

module.exports = {
  getRewriteModePolicy,
  buildDisabledFactInventory
};
