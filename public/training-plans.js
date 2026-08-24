(function(){
  function $(sel){ return document.querySelector(sel); }
  function html(el, s){ if(el) el.innerHTML = s; }
  function esc(s){ return String(s||'').replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
  function api(){ return window.EssayCoachAPI; }

  async function refreshActive(){
    try{
      const plan = await api().getActiveTrainingPlan();
      if(!plan || !plan.id){ html($('#activePlan'), '暂无进行中的计划。'); return; }
      let firstTask = null;
      if(Array.isArray(plan.days)){
        const d0 = plan.days[0];
        firstTask = Array.isArray(d0?.tasks) ? d0.tasks[0] : d0;
      }
      const link = firstTask && firstTask.taskId ? `<p><a class="link" href="/task.html?taskId=${esc(firstTask.taskId)}">查看第 1 天任务</a></p>` : '';
      html($('#activePlan'), `
        <p><strong>计划类型：</strong>${esc(plan.planType||'')}</p>
        <p><strong>开始日期：</strong>${esc(plan.startDate||'未设定')}</p>
        <p><strong>天数：</strong>${(plan.days||[]).length}</p>
        ${link}
      `);
    }catch{ html($('#activePlan'), '无法获取当前计划。'); }
  }

  async function refreshToday(){
    try{
      const today = await api().getTodayTasks();
      const tasks = (today && today.tasks) || [];
      if(!tasks.length){ html($('#todayTasks'), '暂无今日任务。'); return; }
      html($('#todayTasks'), tasks.map(t=>`
        <div class="task-item">
          <strong>${esc(t.title)}</strong>
          <small>${esc(t.relatedDimension||'')} · ${Number(t.expectedMinutes||0)} 分钟</small>
          ${t.taskId? `<div><a class="link" href="/task.html?taskId=${esc(t.taskId)}">进入任务</a></div>`:''}
        </div>
      `).join(''));
    }catch{ html($('#todayTasks'), '无法获取今日任务。'); }
  }

  async function createPlan(planType){
    try{
      await api().createTrainingPlan({ planType, dailyMinutes: 15 });
      alert('计划已生成');
      refreshActive();
      refreshToday();
    }catch(e){ alert('生成计划失败：'+ (e?.message||e)); }
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('[data-plan-type]').forEach(btn=>{
      btn.addEventListener('click', ()=> createPlan(btn.getAttribute('data-plan-type')));
    });
    refreshActive();
    refreshToday();
  });
})();
