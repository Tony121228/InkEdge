const rewritePlanner = require('./rewrite-planner');

function editableSurfaceFor(action) {
  if (action === 'reorder') return ['order', 'sentenceLength'];
  if (action === 'delete') return ['sentenceLength'];
  if (action === 'compress') return ['wording', 'sentenceLength', 'tone'];
  if (action === 'replace') return ['wording', 'tone'];
  return ['wording'];
}

function protectedFactsForGenre(genreGuess) {
  const common = ['subject', 'action', 'object', 'cause', 'time', 'place', 'quantity'];
  if (genreGuess === '记叙文' || genreGuess === '日记') return [...common, 'eventOrder', 'feeling'];
  if (genreGuess === '散文') return [...common, 'observation', 'feeling'];
  if (genreGuess === '议论文') return [...common, 'claimScope', 'evidence'];
  return common;
}

function fallbackActionForGenre(plan, profile) {
  if (profile && profile.genreGuess === '议论文' && (plan && (plan.problemType === '正确但没信息量' || plan.problemType === '公式结构'))) return 'delete';
  if (profile && profile.genreGuess === '散文' && plan && plan.problemType === '宣传腔') return 'compress';
  if (plan && plan.action === 'replace') return 'compress';
  return (plan && plan.action) || 'compress';
}

function plainRewriteTargetForGenre(genreGuess) {
  if (genreGuess === '散文') return '这次……让我对……有了更具体的感受。';
  if (genreGuess === '议论文') return '这个观点还需要更具体的依据。';
  return '这次经历让我对这次经历有了更具体的感受。';
}
function buildExecutableEditPlan(plan, profile = {}, options = {}) {
  const protectFacts = options.protectFacts !== false;
  return rewritePlanner.normalizeEditPlan(plan).map((item) => ({
    ...item,
    editableSurface: editableSurfaceFor(item.action),
    protectedFacts: protectFacts ? protectedFactsForGenre(profile.genreGuess) : [],
    mayAdd: protectFacts ? [] : ['surface_detail_if_needed'],
    mustNotAddFact: protectFacts,
    fallbackAction: fallbackActionForGenre(item, profile),
    plainRewriteTarget: plainRewriteTargetForGenre(profile.genreGuess)
  }));
}

module.exports = {
  buildExecutableEditPlan
};
