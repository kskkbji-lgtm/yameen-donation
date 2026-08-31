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

// ⚙️ 1. ตั้งค่าข้อมูลสตรีมเมอร์ของคุณ
const CONFIG = {
  MY_TRUEMONEY_PHONE: "0967160553", // 👈 ใส่เบอร์ TrueMoney ของคุณที่ต้องการรับเงิน
  STREAMER_NAME: "YameeN Channel"
};

// 📡 ฟังก์ชันยิงแจ้งเตือนไปยัง OBS Alert Box ทุกตัวที่เชื่อมต่ออยู่
function broadcastToOBS(data) {
  const payload = JSON.stringify({ type: 'DONATION_ALERT', data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// -------------------------------------------------------------
// 2. ฟังก์ชันดึงเงินจากซองของขวัญ TrueMoney Wallet เข้าบัญชีจริง
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// 3. API โดเนทผ่าน TrueMoney (เงินเข้าจริงทันที 100%)
// -------------------------------------------------------------
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

      // เมื่อเงินเข้าจริง สั่งเด้งแจ้งเตือนขึ้นจอ OBS ทันที!
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

// -------------------------------------------------------------
// 4. API สำหรับรับคำสั่งทดสอบระบบแจ้งเตือน (Test Alert 1 บาท) ⭐
// -------------------------------------------------------------
app.post('/api/test-alert', (req, res) => {
  const { name, amount, message } = req.body;
  const testData = {
    name: name || 'ผู้ทดสอบระบบ',
    amount: Number(amount) || 1,
    message: message || 'ทดสอบระบบโดเนท 1 บาท เสียงอ่านภาษาไทยทำงานสมบูรณ์ครับ!'
  };

  console.log(`[TEST ALERT] 🧪 ยิงแจ้งเตือนทดสอบ: ฿${testData.amount} จาก: ${testData.name}`);
  
  // สั่งให้หน้าจอ OBS เด้งการ์ดแจ้งเตือนทันที
  broadcastToOBS(testData);
  res.json({ success: true, testData });
});

// -------------------------------------------------------------
// 5. API รับแจ้งเตือนเงินเข้าบัญชีธนาคาร (SCB / K PLUS ผ่าน MacroDroid)
// -------------------------------------------------------------
app.post('/api/bank-notify', (req, res) => {
  const { text } = req.body;
  console.log('[BANK NOTIFY] 📲 ได้รับแจ้งเตือนจากมือถือ:', text);

  if (text) {
    const amountMatch = text.match(/([0-9,]+\.[0-9]{2})/);
    if (amountMatch) {
      const amount = parseFloat(amountMatch.replace(',', ''));
      console.log(`[BANK SUCCESS] 💎 เงินโอนเข้าบัญชีจริง ฿${amount} -> สั่งเด้งจอ OBS`);

      broadcastToOBS({
        name: 'ผู้สนับสนุนผ่านพร้อมเพย์',
        amount: amount,
        message: 'ขอบคุณสำหรับการสนับสนุนครับ!'
      });
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 [DONATION SERVER] รันแล้วที่พอร์ต ${PORT}`);
  console.log(`📱 หน้าโดเนท: http://localhost:${PORT}/index.html`);
  console.log(`🎬 ลิงก์ OBS Alert: http://localhost:${PORT}/alert.html`);
  console.log(`====================================================`);
});
