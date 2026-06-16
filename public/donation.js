// Donation page — fully dynamic, renders only payment methods configured in admin Settings
// Each section appears only when its key field is filled

let upiAmt = 0;
let UPI_ID = '';
let UPI_NAME = '';

function buildUpiUrl() {
  return 'upi://pay?pa=' + encodeURIComponent(UPI_ID)
    + '&pn=' + encodeURIComponent(UPI_NAME)
    + '&cu=INR&tn=Donation';
}

function esc(str) {
  var d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

function renderPaymentMethods(s) {
  var wrap = document.getElementById('paymentMethods');
  if (!wrap) return;
  var html = '';

  // ── 1. UPI section (if upi_id filled) ──
  if (s.upi_id) {
    UPI_ID = s.upi_id;
    UPI_NAME = s.upi_name || 'Devi Murlika Gaur';
    var qrData = 'upi://pay?pa=' + encodeURIComponent(UPI_ID) + '&pn=' + encodeURIComponent(UPI_NAME) + '&cu=INR';
    var qrUrl = 'https://quickchart.io/qr?text=' + encodeURIComponent(qrData) + '&size=172&margin=1';
    var qrFallback = 'https://api.qrserver.com/v1/create-qr-code/?size=172x172&data=' + encodeURIComponent(qrData);

    html += '<div class="pay-card">'
      + '<h3>📱 UPI Payment</h3>'
      + '<table class="upi-table">'
      + '<tr><td>Name</td><td>' + esc(UPI_NAME) + '</td></tr>'
      + '<tr><td>UPI ID</td><td><span id="upiIdText">' + esc(UPI_ID) + '</span> <button type="button" class="copy-btn" id="copyBtn" title="Copy UPI ID">📋 Copy</button></td></tr>'
      + '</table></div>';

    // QR slip
    html += '<div class="qr-slip">'
      + '<div class="qr-slip-header">SCAN AND PAY WITH ANY BHIM UPI'
      + '<span>Use GPay · PhonePe · Paytm · BHIM or any UPI app</span></div>'
      + '<div class="qr-slip-body">'
      + '<div class="qr-wrap"><img id="upiQr" alt="UPI QR Code" width="172" height="172" src="' + qrUrl + '" '
      + 'data-img-fb="' + esc(qrFallback) + '" /></div>'
      + '<div class="qr-name">' + esc(UPI_NAME) + '</div>'
      + '</div></div>';

    // Amount selector
    html += '<div class="amt-section">'
      + '<a id="upiPayBtn" href="' + buildUpiUrl() + '" class="btn" style="width:100%;display:block;text-align:center">💳 Pay with UPI App</a>'
      + '</div>';
  }

  // ── 2. Bank Transfer (if account number filled) ──
  if (s.bank_account_number) {
    html += '<div class="pay-card" style="margin-top:24px">'
      + '<h3>🏦 Bank Transfer (NEFT / IMPS)</h3>'
      + '<table class="upi-table">';
    if (s.bank_account_name) html += '<tr><td>Account Name</td><td>' + esc(s.bank_account_name) + '</td></tr>';
    html += '<tr><td>Account No.</td><td>' + esc(s.bank_account_number) + '</td></tr>';
    if (s.bank_ifsc) html += '<tr><td>IFSC Code</td><td>' + esc(s.bank_ifsc) + '</td></tr>';
    if (s.bank_name) html += '<tr><td>Bank</td><td>' + esc(s.bank_name) + '</td></tr>';
    if (s.bank_branch) html += '<tr><td>Branch</td><td>' + esc(s.bank_branch) + '</td></tr>';
    html += '</table></div>';
  }

  // ── 3. Online Payment Links ──
  var links = '';
  if (s.gpay_number)    links += payRow('📲', 'Google Pay (GPay)', s.gpay_number, null);
  if (s.phonepe_number) links += payRow('📲', 'PhonePe', s.phonepe_number, null);
  if (s.paytm_number)   links += payRow('📲', 'Paytm', s.paytm_number, null);
  if (s.razorpay_link)  links += payRow('💳', 'Razorpay', 'Pay via Razorpay', s.razorpay_link);
  if (s.paypal_link)    links += payRow('🌐', 'PayPal', 'Pay via PayPal', s.paypal_link);

  if (links) {
    html += '<div class="pay-card" style="margin-top:24px">'
      + '<h3>🌐 Other Payment Options</h3>'
      + links + '</div>';
  }

  // ── 4. Custom / Other ──
  if (s.other_payment) {
    html += '<div class="pay-card" style="margin-top:24px">'
      + '<h3>ℹ️ Additional Payment Info</h3>'
      + '<p style="white-space:pre-wrap;line-height:1.7;color:var(--ink)">' + esc(s.other_payment) + '</p>'
      + '</div>';
  }

  if (!html) {
    html = '<div class="no-methods">🙏 Payment methods will be available soon.</div>';
  }

  wrap.innerHTML = html;

  // Wire up UPI interactions after rendering
  if (s.upi_id) wireUpi();
}

function payRow(icon, label, value, href) {
  var val = href
    ? '<a class="pay-value" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(value) + '</a>'
    : '<span class="pay-value">' + esc(value) + '</span>';
  return '<div class="pay-link-row">'
    + '<span class="pay-icon">' + icon + '</span>'
    + '<div class="pay-info"><span class="pay-label">' + esc(label) + '</span>' + val + '</div>'
    + '</div>';
}

function wireUpi() {
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
}

// Restore Pay button after Android back navigation (bfcache)
window.addEventListener('pageshow', function () {
  var btn = document.getElementById('upiPayBtn');
  if (btn) { btn.style.display = 'block'; btn.style.opacity = '1'; }
});

// Load settings and render
document.addEventListener('DOMContentLoaded', function () {
  fetch('/api/settings').then(function (r) { return r.json(); }).then(function (s) {
    // Donation note
    var note = document.getElementById('donateNote');
    if (note && s.donation_note) note.textContent = s.donation_note;

    renderPaymentMethods(s);
  }).catch(function () {
    var wrap = document.getElementById('paymentMethods');
    if (wrap) wrap.innerHTML = '<div class="no-methods">Could not load payment options. Please try again later.</div>';
  });
});
