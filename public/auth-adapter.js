// Pluggable auth UI adapter
(function(){
  var trigger = document.getElementById('authTrigger');
  var builtinModal = document.getElementById('authModal');
  var mount = document.getElementById('authPackageMount');
  if(!mount){
    mount = document.createElement('div');
    mount.id = 'authPackageMount';
    mount.className = 'modal-shell hidden';
    mount.setAttribute('aria-hidden','true');
    document.body.appendChild(mount);
  }

  function hasVendor(){
    return typeof window.renderAuthWidget === 'function' || (window.AuthWidget && typeof window.AuthWidget.render === 'function');
  }

  function openVendor(){
    if(!hasVendor()) return false;
    if(builtinModal){ builtinModal.classList.add('hidden'); builtinModal.setAttribute('aria-hidden','true'); }
    mount.classList.remove('hidden');
    mount.setAttribute('aria-hidden','false');

    var opts = {
      endpoints: {
        sendCode: '/api/auth/send-code',
        verifyCode: '/api/auth/verify-code',
        me: '/api/me',
        logout: '/api/auth/logout'
      },
      brand: '墨锋InkEdge · 我的作文教练账户中心',
      onAuth: function(user){
        var name = document.getElementById('accountName');
        if(name){ name.textContent = (user && (user.displayName||user.email||user.id)) || '已登录用户'; }
      },
      onClose: function(){
        mount.classList.add('hidden');
        mount.setAttribute('aria-hidden','true');
      }
    };

    if(typeof window.renderAuthWidget === 'function'){
      window.renderAuthWidget(mount, opts);
    } else if(window.AuthWidget && typeof window.AuthWidget.render === 'function'){
      window.AuthWidget.render(mount, opts);
    }
    return true;
  }

  if(trigger){
    trigger.addEventListener('click', function(){
      if(!openVendor() && builtinModal){
        builtinModal.classList.remove('hidden');
        builtinModal.setAttribute('aria-hidden','false');
      }
    });
  }
})();
