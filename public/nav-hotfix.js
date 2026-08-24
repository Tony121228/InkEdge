// nav-hotfix.js: ensure side-nav buttons switch views even if app.js fails early
(function(){
  function switchView(id){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const target = document.getElementById('view-' + id);
    if(target){ target.classList.add('active'); }
    document.querySelectorAll('.side-nav .nav-item').forEach(btn=>{
      btn.classList.toggle('active', btn.getAttribute('data-view')===id);
    });
  }
  function bind(){
    document.querySelectorAll('.side-nav .nav-item').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-view');
        if(id){ switchView(id); }
      });
    });
  }
  function ensureDefault(){
    // If no textarea is visible, default to brainstorm view which has inputs
    const hasVisibleTextarea = !!document.querySelector('.view.active textarea, .view.active input[type="text"]');
    if(!hasVisibleTextarea){ switchView('brainstorm'); }
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ bind(); ensureDefault(); });
  } else {
    bind(); ensureDefault();
  }
})();

// Support generic [data-goto] buttons
(function(){
  function clickNav(id){
    var btn = document.querySelector('.side-nav .nav-item[data-view="'+id+'"]');
    if(btn){ btn.click(); try{ document.getElementById('view-'+id).scrollIntoView({behavior:'smooth', block:'start'}); }catch(_){} }
  }
  function bind(){
    document.querySelectorAll('[data-goto]').forEach(function(el){
      el.addEventListener('click', function(){ var id = el.getAttribute('data-goto'); if(id) clickNav(id); });
    });
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', bind); } else { bind(); }
})();
