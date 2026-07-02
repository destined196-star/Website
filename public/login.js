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

  // ── Forgot Password ────────────────────────────────────────────────────
  var stepForgot   = document.getElementById('stepForgot');
  var stepReset    = document.getElementById('stepReset');
  var forgotLink   = document.getElementById('forgotLink');
  var forgotUser   = document.getElementById('forgotUser');
  var sendOtpBtn   = document.getElementById('sendOtpBtn');
  var forgotBackBtn= document.getElementById('forgotBackBtn');
  var resetOtp     = document.getElementById('resetOtp');
  var newPass      = document.getElementById('newPass');
  var newPass2     = document.getElementById('newPass2');
  var resetBtn     = document.getElementById('resetBtn');
  var resetBackBtn = document.getElementById('resetBackBtn');
  var successMsg   = document.getElementById('successMsg');
  var eyeBtn2      = document.getElementById('eyeBtn2');
  var _forgotUsername = '';

  function showStep(show) {
    [step1, step2, stepForgot, stepReset].forEach(function(s){ s.style.display='none'; s.classList.remove('show'); });
    show.style.display = '';
    show.classList.add('show');
    clearErr();
    if (successMsg) { successMsg.classList.remove('show'); }
  }

  forgotLink.addEventListener('click', function () {
    showStep(stepForgot);
    forgotUser.value = userEl.value || '';
    forgotUser.focus();
  });

  forgotBackBtn.addEventListener('click', function () {
    showStep(step1);
    userEl.focus();
  });

  resetBackBtn.addEventListener('click', function () {
    showStep(step1);
    userEl.focus();
  });

  if (eyeBtn2) {
    eyeBtn2.addEventListener('click', function () {
      var show = newPass.type === 'password';
      newPass.type = show ? 'text' : 'password';
      eyeBtn2.textContent = show ? '🙈' : '👁️';
    });
  }

  function doSendOtp() {
    clearErr();
    var username = forgotUser.value.trim();
    if (!username) { showErr('Enter your username.'); return; }
    _forgotUsername = username;
    setLoading(sendOtpBtn, true, 'Send Reset Code');
    fetch('/api/forgot-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: username })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(sendOtpBtn, false, 'Send Reset Code');
      if (res.ok || res.d.sent) {
        showStep(stepReset);
        successMsg.textContent = '✅ Reset code sent to the registered email. Check your inbox (and spam).';
        successMsg.classList.add('show');
        resetOtp.focus();
        return;
      }
      showErr(res.d.error || 'Could not send code.');
    })
    .catch(function () {
      setLoading(sendOtpBtn, false, 'Send Reset Code');
      showErr('Network error — please try again.');
    });
  }

  function doReset() {
    clearErr();
    var otp = resetOtp.value.replace(/\s/g, '');
    var pw  = newPass.value;
    var pw2 = newPass2.value;
    if (otp.length !== 6) { showErr('Enter the 6-digit code from your email.'); return; }
    if (!pw) { showErr('Enter a new password.'); return; }
    if (pw !== pw2) { showErr('Passwords do not match.'); return; }
    setLoading(resetBtn, true, 'Reset Password');
    fetch('/api/reset-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: _forgotUsername, otp: otp, new_password: pw })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(resetBtn, false, 'Reset Password');
      if (res.ok) {
        showStep(step1);
        clearErr();
        userEl.value = _forgotUsername;
        passEl.value = '';
        passEl.placeholder = '✅ Password reset — sign in with new password';
        passEl.focus();
        return;
      }
      showErr(res.d.error || 'Reset failed.');
    })
    .catch(function () {
      setLoading(resetBtn, false, 'Reset Password');
      showErr('Network error — please try again.');
    });
  }

  sendOtpBtn.addEventListener('click', doSendOtp);
  resetBtn.addEventListener('click', doReset);
  forgotUser.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSendOtp(); });
  resetOtp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doReset(); });

  fetch('/api/me', { credentials: 'include', headers: { 'X-Requested-With': 'fetch' } })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.admin) window.location.replace('/admin'); })
    .catch(function () {});

  userEl.focus();
})();
