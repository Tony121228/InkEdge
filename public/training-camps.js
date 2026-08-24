(function(){
  const CAMPS = [
    ['审题能力','圈关键词、判断题眼、排除跑题角度。'],
    ['立意能力','为同一材料选择不同立意。'],
    ['素材能力','记录真实经历并标注可用主题。'],
    ['细节能力','动作扩写、对话扩写、心理扩写。'],
    ['结构能力','排序段落、补提纲、调整重点。'],
    ['语言能力','删空话、改套话、保留学生表达。'],
    ['修改能力','对照问题清单逐条修改。'],
    ['考场表达能力','在时间限制内快速成稿。']
  ];
  function esc(s){ return String(s||'').replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
  function card([name, text]){
    return `
      <article class="feature-card">
        <div class="feature-top"><span>待开始</span><strong>专项</strong></div>
        <h3>${esc(name)}</h3>
        <p>${esc(text)}</p>
        <button class="primary" data-dimension="${esc(name)}">生成 7 天计划</button>
      </article>`;
  }
  async function createCampPlan(dim){
    try{
      await window.EssayCoachAPI.createTrainingPlan({ planType:'7d', dailyMinutes:15, focusDimensions:[dim] });
      alert('已生成 7 天训练计划');
      location.href = '/training-plans.html';
    }catch(e){ alert('生成失败：'+(e?.message||e)); }
  }
  document.addEventListener('DOMContentLoaded', ()=>{
    const list = CAMPS.map(card).join('');
    document.querySelector('#campList').innerHTML = list;
    document.querySelectorAll('[data-dimension]').forEach(btn=>{
      btn.addEventListener('click', ()=> createCampPlan(btn.getAttribute('data-dimension')));
    });
  });
})();
