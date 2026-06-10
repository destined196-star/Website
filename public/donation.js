// Donation page — amount selector updates Pay button only
// QR code is STATIC (no amount encoded) — never changes

const UPI_ID = 'mab.037215011050006@axisbank';
const UPI_NAME = 'Devi Murlika Gaur';
let upiAmt = 251;

function buildUpiUrl(amt) {
  return 'upi://pay?pa=' + encodeURIComponent(UPI_ID)
    + '&pn=' + encodeURIComponent(UPI_NAME)
    + '&am=' + encodeURIComponent(amt)
    + '&cu=INR&tn=Donation';
}

// Only updates the Pay button href — QR is never touched
function refreshPayBtn() {
  var btn = document.getElementById('upiPayBtn');
  if (btn) btn.href = buildUpiUrl(upiAmt);
}

// Restore Pay button after Android back navigation (bfcache)
window.addEventListener('pageshow', function () {
  var btn = document.getElementById('upiPayBtn');
  if (btn) { btn.style.display = 'block'; btn.style.opacity = '1'; }
});

// QR fallback (static src, loaded once)
document.addEventListener('DOMContentLoaded', function () {
  var img = document.getElementById('upiQr');
  if (img) {
    img.onerror = function () {
      if (!this.dataset.fallback) {
        this.dataset.fallback = '1';
        // Fallback static QR — still no amount
        this.src = 'https://api.qrserver.com/v1/create-qr-code/?size=172x172&data='
          + encodeURIComponent('upi://pay?pa=' + UPI_ID + '&pn=' + encodeURIComponent(UPI_NAME) + '&cu=INR');
      }
    };
  }

  // Amount preset buttons
  document.querySelectorAll('#upiAmtRow button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#upiAmtRow button').forEach(function (x) { x.classList.remove('sel'); });
      this.classList.add('sel');
      upiAmt = Number(this.dataset.amt);
      var ci = document.getElementById('customAmt');
      if (ci) ci.value = '';
      refreshPayBtn();
    });
  });

  // Custom amount
  function applyCustomAmt() {
    var input = document.getElementById('customAmt');
    var val = parseInt(input.value, 10);
    if (!val || val < 1) return;
    document.querySelectorAll('#upiAmtRow button').forEach(function (x) { x.classList.remove('sel'); });
    upiAmt = val;
    refreshPayBtn();
  }
  var customInput = document.getElementById('customAmt');
  if (customInput) {
    customInput.addEventListener('input', applyCustomAmt);
    customInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyCustomAmt(); });
  }

  // Safety net: re-read custom input on Pay click (capture phase)
  var payBtn = document.getElementById('upiPayBtn');
  if (payBtn) {
    payBtn.addEventListener('click', function (e) {
      var ci = document.getElementById('customAmt');
      if (ci && ci.value) {
        var v = parseInt(ci.value, 10);
        if (v > 0) { upiAmt = v; refreshPayBtn(); }
      }
      // Desktop warning
      if (!/android|iphone|ipad|mobile/i.test(navigator.userAgent)) {
        e.preventDefault();
        alert('On desktop: scan the QR code with GPay / PhonePe / Paytm on your phone.');
      }
    }, true);
  }

  // Copy UPI ID
  var copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var self = this;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(UPI_ID).then(function () {
          self.textContent = '✅ Copied';
          setTimeout(function () { self.textContent = '📋 Copy'; }, 2000);
        }).catch(function () { prompt('Copy this UPI ID:', UPI_ID); });
      } else {
        prompt('Copy this UPI ID:', UPI_ID);
      }
    });
  }
});
