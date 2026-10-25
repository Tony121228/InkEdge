const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const appHtml = read('public/app.html');
const appJs = read('public/app.js');
const plansHtml = read('public/training-plans.html');
const plansJs = read('public/training-plans.js');

assert(appHtml.includes('id="view-training"'), 'main app should keep the training view');
assert(appHtml.includes('id="trainingWorkspace"'), 'main app training view should expose the new clean workspace mount');
assert(!appHtml.includes('id="trainingCamps"'), 'main app training view should remove the old duplicated training camp mount');
assert(!appHtml.includes('id="trainingPlan" class="plan-grid"'), 'main app training view should remove the old plan-grid placeholder');
assert(appJs.includes('loadTrainingWorkspaceSummary'), 'main app should load the new training workspace summary');
assert(appJs.includes('renderTrainingWorkspaceSummary'), 'main app should render the new training workspace summary');
assert(!appJs.includes('renderTrainingPlan'), 'main app should remove old renderTrainingPlan references');
assert(!appJs.includes('renderTrainingCamps'), 'main app should remove old renderTrainingCamps references');
assert(!appJs.includes('training-camps'), 'main app should remove old training camp feature references');
assert(!appJs.includes('function renderTrainingCamps'), 'main app should remove old renderTrainingCamps implementation');
assert(!appJs.includes('renderTrainingCamps()'), 'main app should stop calling old renderTrainingCamps');

assert(plansHtml.includes('id="trainingWorkbench"'), 'training page should expose the new workbench root');
assert(plansHtml.includes('id="trainingCreatePanel"'), 'training page should expose the create panel mount');
assert(plansHtml.includes('id="trainingStageTimeline"'), 'training page should expose the stage timeline mount');
assert(plansHtml.includes('id="trainingStagePanel"'), 'training page should expose the current stage panel mount');
assert(plansHtml.includes('id="trainingArtifactPanel"'), 'training page should expose the artifact panel mount');
assert(plansHtml.includes('id="trainingNextStepPanel"'), 'training page should expose the next-step panel mount');
assert(!plansHtml.includes('专项训练营'), 'training page should remove the unrelated training camp navigation and panel');
assert(!plansHtml.includes('id="activePlan"'), 'training page should remove the old activePlan placeholder');
assert(!plansHtml.includes('id="todayTasks"'), 'training page should remove the old todayTasks placeholder');
assert(!plansHtml.includes('id="stageInputArea"'), 'training page should remove the old generic stage input placeholder');
assert(!plansHtml.includes('id="stageArtifactArea"'), 'training page should remove the old generic artifact placeholder');

assert(plansJs.includes('renderTrainingWorkspace'), 'training page JS should expose the new workbench renderer');
for (const renderer of [
  'renderTopicAngleStage',
  'renderMaterialQuestionsStage',
  'renderOutlineTreeStage',
  'renderParagraphGuidesStage',
  'renderParagraphDraftingStage',
  'renderDraftDiagnosisStage',
  'renderRevisionReflectionStage'
]) {
  assert(plansJs.includes(renderer), `training page JS should render stage-specific UI: ${renderer}`);
}
for (const interactionHook of [
  'collectCurrentStageInput',
  'cacheCurrentStageInput',
  'stageCanRun',
  'mergeStageRunResult',
  'data-action="run-stage"',
  'data-action="go-next-stage"',
  'data-action="select-angle"',
  'stage-answer-input',
  'paragraph-draft-input',
  'priority-issue-choice',
  'outline-tree'
]) {
  assert(plansJs.includes(interactionHook), `training page JS should include interaction hook: ${interactionHook}`);
}
for (const detailedGuidanceHook of [
  'detailListMarkup',
  'whyThisFitsTopic',
  'materialConnection',
  'writingPath',
  'keyDetailsToAsk',
  'riskReminder',
  'writeTask',
  'writingObjects',
  'detailPlan',
  'eventBeats',
  'emotionShift',
  'transitionHint',
  'studentChecklist',
  'writingTargets',
  'howToWrite',
  'detailsToInclude',
  'developmentSteps',
  'sensoryDetails',
  'innerThoughtPrompts',
  'selfCheck'
]) {
  assert(plansJs.includes(detailedGuidanceHook), `training page JS should render detailed guidance hook: ${detailedGuidanceHook}`);
}
assert(!plansJs.includes('function artifactPreview'), 'training page JS should remove the old artifactPreview implementation');
assert(!plansJs.includes('function renderPlanOverview'), 'training page JS should remove the old renderPlanOverview implementation');
assert(!plansJs.includes('function renderTrainingCamps'), 'training page JS should not include training camp rendering');
assert(!plansJs.includes('JSON.stringify(artifact, null, 2)'), 'training page should not directly dump artifact JSON to users');

for (const removedPlanText of ['14 天', '30 天', '考前 10 天', 'examSprint']) {
  assert(!plansHtml.includes(removedPlanText), `training plan page should not show unrelated preset: ${removedPlanText}`);
}
