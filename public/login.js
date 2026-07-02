(function () {
  var userEl     = document.getElementById('user');
  var passEl     = document.getElementById('pass');
  var totpEl     = document.getElementById('totp');
  var errEl      = document.getElementById('err');
  var successMsg = document.getElementById('successMsg');
  var step1      = document.getElementById('step1');
  var step2      = document.getElementById('step2');
  var stepForgot = document.getElementById('stepForgot');
  var stepReset  = document.getElementById('stepReset');
  var loginBtn   = document.getElementById('loginBtn');
  var verifyBtn  = document.getElementById('verifyBtn');
  var eyeBtn     = document.getElementById('eyeBtn');
  var eyeBtn2    = document.getElementById('eyeBtn2');
  var forgotLink = document.getElementById('forgotLink');
  var backBtn    = document.getElementById('backBtn');
  var backSep    = document.getElementById('backSep');
  var forgotUser = document.getElementById('forgotUser');
  var sendOtpBtn = document.getElementById('sendOtpBtn');
  var resetOtp   = document.getElementById('resetOtp');
  var newPass    = document.getElementById('newPass');
  var newPass2   = document.getElementById('newPass2');
  var resetBtn   = document.getElementById('resetBtn');
  var _forgotId  = ''; // stores username/email used in forgot flow

  function showErr(msg) { errEl.textContent = msg; errEl.classList.add('show'); successMsg.classList.remove('show'); }
  function clearErr()   { errEl.classList.remove('show'); }
  function showSuccess(msg) { successMsg.textContent = msg; successMsg.classList.add('show'); errEl.classList.remove('show'); }

  function showStep(active) {
    [step1, step2, stepForgot, stepReset].forEach(function (s) {
      s.style.display = 'none'; s.classList.remove('show');
    });
    active.style.display = ''; active.classList.add('show');
    clearErr(); successMsg.classList.remove('show');
    // Show/hide back link
    var isForgot = (active === stepForgot || active === stepReset);
    forgotLink.style.display = isForgot ? 'none' : '';
    backBtn.style.display = isForgot ? '' : 'none';
    backSep.style.display = isForgot ? '' : 'none';
  }

  function setLoading(btn, loading, label) {
    btn.disabled = loading; btn.textContent = loading ? '…' : label;
  }

  // ── Eye toggles ──
  eyeBtn.addEventListener('click', function () {
    var show = passEl.type === 'password';
    passEl.type = show ? 'text' : 'password';
    eyeBtn.textContent = show ? '🙈' : '👁️';
  });
  if (eyeBtn2) {
    eyeBtn2.addEventListener('click', function () {
      var show = newPass.type === 'password';
      newPass.type = show ? 'text' : 'password';
      eyeBtn2.textContent = show ? '🙈' : '👁️';
    });
  }

  // ── Nav ──
  forgotLink.addEventListener('click', function () {
    showStep(stepForgot);
    if (userEl.value) forgotUser.value = userEl.value;
    forgotUser.focus();
  });
  backBtn.addEventListener('click', function () {
    showStep(step1); userEl.focus();
  });

  // ── Login ──
  function doLogin() {
    clearErr();
    var username = userEl.value.trim();
    var password = passEl.value;
    if (!username || !password) { showErr('Enter your username and password.'); return; }
    setLoading(loginBtn, true, 'Log In');
    fetch('/api/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: username, password: password })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(loginBtn, false, 'Log In');
      if (res.ok) { window.location.replace('/admin'); return; }
      if (res.d.error === '2fa_required') {
        step1.style.display = 'none'; step1.classList.remove('show');
        step2.style.display = ''; step2.classList.add('show');
        forgotLink.style.display = 'none';
        totpEl.focus(); return;
      }
      showErr(res.d.error || 'Invalid credentials.');
    })
    .catch(function () { setLoading(loginBtn, false, 'Log In'); showErr('Network error — try again.'); });
  }

  // ── TOTP ──
  function do2fa() {
    clearErr();
    var token = totpEl.value.replace(/\s/g, '');
    if (token.length !== 6) { showErr('Enter the 6-digit authenticator code.'); return; }
    setLoading(verifyBtn, true, 'Verify & Log In');
    fetch('/api/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: userEl.value.trim(), password: passEl.value, token: token })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(verifyBtn, false, 'Verify & Log In');
      if (res.ok) { window.location.replace('/admin'); return; }
      showErr(res.d.error || 'Invalid code.');
    })
    .catch(function () { setLoading(verifyBtn, false, 'Verify & Log In'); showErr('Network error — try again.'); });
  }

  // ── Forgot — send OTP ──
  function doSendOtp() {
    clearErr();
    var val = forgotUser.value.trim();
    if (!val) { showErr('Enter your username or email address.'); return; }
    _forgotId = val;
    setLoading(sendOtpBtn, true, 'Get New Password');
    fetch('/api/forgot-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ username: val })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(sendOtpBtn, false, 'Get New Password');
      showStep(stepReset);
      showSuccess('Check your email for the reset code. It expires in 15 minutes.');
      resetOtp.focus();
    })
    .catch(function () { setLoading(sendOtpBtn, false, 'Get New Password'); showErr('Network error — try again.'); });
  }

  // ── Reset password ──
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
      body: JSON.stringify({ username: _forgotId, otp: otp, new_password: pw })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      setLoading(resetBtn, false, 'Reset Password');
      if (res.ok) {
        showStep(step1);
        userEl.value = _forgotId;
        passEl.value = '';
        showSuccess('Password reset successfully. You can now log in.');
        passEl.focus(); return;
      }
      showErr(res.d.error || 'Reset failed.');
    })
    .catch(function () { setLoading(resetBtn, false, 'Reset Password'); showErr('Network error — try again.'); });
  }

  // ── Event bindings ──
  loginBtn.addEventListener('click', doLogin);
  verifyBtn.addEventListener('click', do2fa);
  sendOtpBtn.addEventListener('click', doSendOtp);
  resetBtn.addEventListener('click', doReset);
  [userEl, passEl].forEach(function (el) { el.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); }); });
  totpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') do2fa(); });
  forgotUser.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSendOtp(); });
  resetOtp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doReset(); });

  // Redirect if already logged in
  fetch('/api/me', { credentials: 'include', headers: { 'X-Requested-With': 'fetch' } })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.admin) window.location.replace('/admin'); })
    .catch(function () {});

  userEl.focus();
})();
