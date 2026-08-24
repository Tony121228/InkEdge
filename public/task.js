(function(){
  function $(s){ return document.querySelector(s); }
  function esc(s){ return String(s||'').replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
  function getParam(name){ const u=new URL(location.href); return u.searchParams.get(name); }
  async function loadTask(){
    const id = getParam('taskId');
    if(!id){ $('#taskTitle').textContent='未指定任务'; return; }
    try{
      const data = await window.EssayCoachAPI.getTrainingTask(id);
      const t = data.task || data;
      $('#taskTitle').textContent = t.title || '任务';
      $('#taskMeta').textContent = `${t.relatedDimension||''} · 预计 ${Number(t.expectedMinutes||0)} 分钟`;
      $('#taskInstruction').textContent = t.instruction || '';
    }catch(e){ $('#taskInstruction').textContent = '无法获取任务详情：'+(e?.message||e); }
  }
  async function submit(){
    const id = getParam('taskId');
    const content = $('#submission').value.trim();
    try{
      await window.EssayCoachAPI.submitTrainingTask(id, { content });
      $('#submitResult').textContent = '已提交。';
    }catch(e){ $('#submitResult').textContent = '提交失败：'+(e?.message||e); }
  }
  async function feedback(){
    const id = getParam('taskId');
    const content = $('#submission').value.trim();
    try{
      const r = await window.EssayCoachAPI.getTrainingFeedback(id, { content });
      const o = r || {};
      $('#feedback').innerHTML = `
        <p><strong>点评：</strong>${esc(o.feedback||'')}</p>
        <p><strong>分数：</strong>${Number(o.score||0)}</p>
        <p><strong>改进提示：</strong>${esc(o.improvedVersionHint||'')}</p>
      `;
    }catch(e){ $('#feedback').textContent = '获取失败：'+(e?.message||e); }
  }
  document.addEventListener('DOMContentLoaded', ()=>{
    loadTask();
    $('#btnSubmit').addEventListener('click', submit);
    $('#btnFeedback').addEventListener('click', feedback);
  });
})();
