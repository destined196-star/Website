// Donation page — UPI amount selector + QR updater
// Loaded as external script (inline scripts blocked by CSP script-src 'self')

const UPI_ID = 'mab.037215011050006@axisbank';
const UPI_NAME = 'Devi Murlika Gaur';
let upiAmt = 251;

function buildUpiUrl(amt) {
  return 'upi://pay?pa=' + encodeURIComponent(UPI_ID)
    + '&pn=' + encodeURIComponent(UPI_NAME)
    + '&am=' + encodeURIComponent(amt)
    + '&cu=INR&tn=Donation';
}

function buildQrUrl(upiUrl) {
  return 'https://quickchart.io/qr?text=' + encodeURIComponent(upiUrl) + '&size=160&margin=1';
}

function refreshUpi() {
  const upiUrl = buildUpiUrl(upiAmt);
  const img = document.getElementById('upiQr');
  const btn = document.getElementById('upiPayBtn');
  btn.href = upiUrl;
  img.dataset.fallback = '';
  img.src = buildQrUrl(upiUrl);
}

document.addEventListener('DOMContentLoaded', function () {
  // QR error → fallback to api.qrserver.com
  const img = document.getElementById('upiQr');
  if (img) {
    img.onerror = function () {
      if (!this.dataset.fallback) {
        this.dataset.fallback = '1';
        this.src = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data='
          + encodeURIComponent(buildUpiUrl(upiAmt));
      }
    };
  }

  // Amount buttons
  document.querySelectorAll('#upiAmtRow button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#upiAmtRow button').forEach(function (x) {
        x.classList.remove('sel');
      });
      this.classList.add('sel');
      upiAmt = Number(this.dataset.amt);
      refreshUpi();
    });
  });

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

  // Pay button: on desktop warn to scan QR instead
  var payBtn = document.getElementById('upiPayBtn');
  if (payBtn) {
    payBtn.addEventListener('click', function (e) {
      if (!/android|iphone|ipad|mobile/i.test(navigator.userAgent)) {
        e.preventDefault();
        alert('On desktop: scan the QR code with GPay / PhonePe / Paytm on your phone.');
      }
    });
  }
});
