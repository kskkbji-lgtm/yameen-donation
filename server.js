const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const https = require('https');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ⚙️ 1. ใส่เบอร์ TrueMoney ของคุณที่นี่
const CONFIG = {
  MY_TRUEMONEY_PHONE: "0812345678", // 👈 เปลี่ยนเป็นเบอร์ TrueMoney ของคุณ
  STREAMER_NAME: "YameeN Channel"
};

function broadcastToOBS(data) {
  const payload = JSON.stringify({ type: 'DONATION_ALERT', data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function redeemTrueMoneyVoucher(voucherHash, phoneNumber) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ mobile: phoneNumber, voucher_hash: voucherHash });
    const options = {
      hostname: 'gift.truemoney.com',
      path: `/campaign/vouchers/${voucherHash}/redeem`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

app.post('/api/donate-truemoney', async (req, res) => {
  const { name, voucherUrl, message } = req.body;

  if (!voucherUrl) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกลิงก์ซองของขวัญ' });
  }

  const match = voucherUrl.match(/v=([a-zA-Z0-9]+)/);
  if (!match) {
    return res.status(400).json({ success: false, message: 'รูปแบบลิงก์ซองไม่ถูกต้อง' });
  }

  const voucherHash = match;

  try {
    const result = await redeemTrueMoneyVoucher(voucherHash, CONFIG.MY_TRUEMONEY_PHONE);

    if (result.status && result.status.code === 'SUCCESS') {
      const amount = parseFloat(result.data.my_ticket.amount_baht);
      const donorName = name ? name.trim() : 'ผู้สนับสนุน TrueMoney';
      const donorMsg = message ? message.trim() : '';

      console.log(`[TRUEMONEY] 💰 เงินเข้าบัญชีจริง ฿${amount} จาก: ${donorName}`);

      broadcastToOBS({
        name: donorName,
        amount: amount,
        message: donorMsg
      });

      return res.json({ success: true, amount });
    } else {
      const errorMsg = result.status ? result.status.message : 'ซองนี้ถูกใช้งานไปแล้ว หรือหมดอายุ';
      return res.status(400).json({ success: false, message: errorMsg });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงเงิน' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Donation Server Online on port ${PORT}`);
});
