(function () {
  var userEl   = document.getElementById('user');
  var passEl   = document.getElementById('pass');
  var totpEl   = document.getElementById('totp');
  var errEl    = document.getElementById('err');
  var step1    = document.getElementById('step1');
  var step2    = document.getElementById('step2');
  var loginBtn = document.getElementById('loginBtn');
  var verifyBtn= document.getElementById('verifyBtn');
  var eyeBtn   = document.getElementById('eyeBtn');
  var backBtn  = document.getElementById('backBtn');

  function showErr(msg) { errEl.textContent = msg; errEl.classList.add('show'); }
  function clearErr()   { errEl.classList.remove('show'); }

  eyeBtn.addEventListener('click', function () {
    var show = passEl.type === 'password';
    passEl.type = show ? 'text' : 'password';
    eyeBtn.textContent = show ? '🙈' : '👁️';
  });

  backBtn.addEventListener('click', function () {
    step2.classList.remove('show');
    step1.style.display = '';
    clearErr();
    totpEl.value = '';
  });

  function setLoading(btn, loading, label) {
    btn.disabled = loading;
    btn.textContent = loading ? '…' : label;
  }

  function doLogin() {
    clearErr();
    var username = userEl.value.trim();
    var password = passEl.value;
    if (!username || !password) { showErr('Enter your username and password.'); return; }
    setLoading(loginBtn, true, 'Sign In');
    fetch('/api/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: username, password: password })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(loginBtn, false, 'Sign In');
      if (res.ok) { window.location.replace('/admin'); return; }
      if (res.d.error === '2fa_required') {
        step1.style.display = 'none';
        step2.classList.add('show');
        totpEl.focus();
        return;
      }
      showErr(res.d.error || 'Invalid credentials.');
    })
    .catch(function () {
      setLoading(loginBtn, false, 'Sign In');
      showErr('Network error — please try again.');
    });
  }

  function do2fa() {
    clearErr();
    var token = totpEl.value.replace(/\s/g, '');
    if (token.length !== 6) { showErr('Enter the 6-digit code from your authenticator app.'); return; }
    setLoading(verifyBtn, true, 'Verify & Sign In');
    fetch('/api/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: userEl.value.trim(), password: passEl.value, token: token })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(verifyBtn, false, 'Verify & Sign In');
      if (res.ok) { window.location.replace('/admin'); return; }
      showErr(res.d.error || 'Invalid code.');
    })
    .catch(function () {
      setLoading(verifyBtn, false, 'Verify & Sign In');
      showErr('Network error — please try again.');
    });
  }

  loginBtn.addEventListener('click', doLogin);
  verifyBtn.addEventListener('click', do2fa);
  [userEl, passEl].forEach(function (el) {
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  });
  totpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') do2fa(); });

  fetch('/api/me', { credentials: 'include', headers: { 'X-Requested-With': 'fetch' } })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.admin) window.location.replace('/admin'); })
    .catch(function () {});

  userEl.focus();
})();
