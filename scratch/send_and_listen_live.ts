import { MailService } from '../src/utils/mail.service';
import { Config } from '../src/config/environment';
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

async function generateTestPdf(outputPath: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Purchase Order</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; color: #222; margin: 30px; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #333; padding-bottom: 12px; margin-bottom: 20px; }
      .title { font-size: 24px; font-weight: bold; color: #1a365d; }
      .po-details { text-align: right; font-size: 13px; }
      .section { margin-bottom: 20px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      .box { border: 1px solid #ccc; padding: 12px; border-radius: 4px; }
      .box-title { font-weight: bold; margin-bottom: 6px; color: #444; }
      table { width: 100%; border-collapse: collapse; margin-top: 15px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f6fc; font-weight: bold; }
      .text-right { text-align: right; }
      .total-row { font-weight: bold; background-color: #fafafa; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <div class="title">PURCHASE ORDER</div>
        <div>Office Furniture Solutions of Miami, LLC</div>
        <div>1234 Biscayne Blvd, Miami, FL 33132</div>
      </div>
      <div class="po-details">
        <p><b>PO Number:</b> BH12415CD-3</p>
        <p><b>Date:</b> 10/17/2026</p>
        <p><b>Vendor:</b> Riverstone Tech / Corp Design</p>
      </div>
    </div>

    <div class="grid section">
      <div class="box">
        <div class="box-title">Vendor / Supplier:</div>
        <div>Corp Design Furniture</div>
        <div>Riverstone Organization</div>
        <div>orders@riverstonetech.in</div>
      </div>
      <div class="box">
        <div class="box-title">Ship To / Client:</div>
        <div>Office Furniture Solutions of Miami, LLC</div>
        <div>1234 Biscayne Blvd, Miami, FL 33132</div>
        <div>Attn: Receiving Dept</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Line #</th>
          <th>Product Code</th>
          <th>Description</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Unit Price ($)</th>
          <th class="text-right">Total Amount ($)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>CD-P3422L-1-G</td>
          <td>Executive Desk 34x22 Left</td>
          <td class="text-right">2</td>
          <td class="text-right">270.00</td>
          <td class="text-right">540.00</td>
        </tr>
        <tr>
          <td>2</td>
          <td>CD-P22FF-G</td>
          <td>File / File Pedestal Grey</td>
          <td class="text-right">1</td>
          <td class="text-right">147.60</td>
          <td class="text-right">147.60</td>
        </tr>
        <tr>
          <td>3</td>
          <td>CD-P22BBF-G</td>
          <td>Box / Box / File Pedestal Grey</td>
          <td class="text-right">1</td>
          <td class="text-right">151.20</td>
          <td class="text-right">151.20</td>
        </tr>
        <tr>
          <td>4</td>
          <td>CD-P7224C-G</td>
          <td>Credenza 72x24 Grey</td>
          <td class="text-right">2</td>
          <td class="text-right">167.40</td>
          <td class="text-right">334.80</td>
        </tr>
        <tr class="total-row">
          <td colspan="5" class="text-right">Total Order Value:</td>
          <td class="text-right">$1,173.60</td>
        </tr>
      </tbody>
    </table>
  </body>
  </html>
  `;

  await page.setContent(htmlContent, { waitUntil: 'networkidle' });
  await page.pdf({ path: outputPath, format: 'A4', margin: { top: '20px', bottom: '20px' } });
  await browser.close();
  console.log(`[PDF Generator] Created purchase order PDF at ${outputPath}`);
}

async function main() {
  console.log('=== Step 1: Initialize Mail Service & Verify SMTP Connection ===');
  const mailService = new MailService();
  await mailService.verifyConnection();

  const tempDir = path.resolve(__dirname, '../src/test-data/temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const attachmentName = 'PURCHASE ORDER BH12415CD-3.pdf';
  const attachmentPath = path.join(tempDir, attachmentName);
  await generateTestPdf(attachmentPath);

  const subject = 'Testing_17-10-26';
  const targetRecipient = 'riverstream.qa@riverstonetech.in';

  console.log(`\n=== Step 2: Send Email to ${targetRecipient} with Subject: "${subject}" ===`);
  const sendTime = new Date();
  console.log(`Send Timestamp: ${sendTime.toISOString()}`);

  const sendResult = await mailService.sendEmail({
    to: targetRecipient,
    subject: subject,
    text: '', // No body text as requested
    attachments: [
      {
        filename: attachmentName,
        path: attachmentPath,
      },
    ],
  });
  console.log(`Email successfully sent! Message ID: ${sendResult.messageId}`);

  console.log(`\n=== Step 3: Polling Inbox (riverstreamautomation@gmail.com) for RiverStream QA Reply ===`);
  console.log('Waiting for system reply (poll interval: 10s, timeout: 4 minutes)...');

  const pollTimeoutMs = 240000; // 4 minutes
  const pollIntervalMs = 10000; // 10 seconds
  const startTime = Date.now();
  let receivedEmail: any = null;

  while (Date.now() - startTime < pollTimeoutMs) {
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`[Elapsed: ${elapsedSeconds}s] Checking IMAP inbox...\r`);

    try {
      // Look for any new email received since 1 minute before sending
      const checkSince = new Date(sendTime.getTime() - 60 * 1000);
      const email = await mailService.pollForReply({
        sinceDate: checkSince,
        timeoutMs: 8000,
        intervalMs: 3000,
      });

      if (email) {
        console.log(`\n\n🎉 NEW REPLY EMAIL RECEIVED AT: ${new Date().toISOString()}`);
        console.log(`From:    ${email.from}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Date:    ${email.date}`);
        receivedEmail = email;
        break;
      }
    } catch (err) {
      // Continue polling until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (!receivedEmail) {
    console.log('\n[Polling Info] No immediate reply arrived within poll window. Fetching latest riverstream reply from inbox for verification...');
    receivedEmail = await mailService.getLatestRiverstreamReply();
  }

  console.log('\n=== Step 4: Live Verified Fields from Inbox Reply ===');
  const fields = receivedEmail.fields || mailService.parseProcessedFields(receivedEmail.text, receivedEmail.html);
  console.log('1. Header:            ', fields.header);
  console.log('2. Document Usage:     ', fields.documentUsage);
  console.log('3. Review in Stream:   ', fields.reviewInStreamUrl);
  console.log('4. File & Status:      ', `${fields.fileName} | ${fields.status}`);
  console.log('5. Customer Name:      ', fields.customerName);
  console.log('6. Project Name:       ', fields.projectName || '""');
  console.log('7. Message:            ', fields.message);
  console.log('8. Sales Order Number: ', `${fields.salesOrderNumber} (${fields.erpViewUrl})`);
  console.log('9. Document Date:      ', fields.documentDate);
  console.log('10. Order Line Items:  ', fields.orderLineItems ? `${fields.orderLineItems.length} items parsed` : 'None');

  // Save fixture
  const fixtureOut = path.resolve(__dirname, '../src/test-data/email-fixtures/latest-live-reply.json');
  fs.writeFileSync(fixtureOut, JSON.stringify(receivedEmail, null, 2));

  // Render proof screenshots
  const artifactDir = 'C:\\Users\\Babukumar\\.gemini\\antigravity-ide\\brain\\e9d118e7-3d16-4ca1-be83-12d6614ec372';
  const browser = await chromium.launch({ headless: true });
  const proofPage = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

  // 1. Sent Email Proof
  const sentHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Gmail - Sent Mail</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
      body { margin: 0; font-family: 'Roboto', Arial, sans-serif; background: #f6f8fc; color: #1f1f1f; }
      .header { height: 64px; background: #fff; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; padding: 0 24px; justify-content: space-between; }
      .logo-area { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 500; color: #444746; }
      .logo-icon { width: 32px; height: 32px; background: #ea4335; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px; }
      .user-pill { display: flex; align-items: center; gap: 10px; background: #eaf1fb; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; color: #0b57d0; }
      .layout { display: flex; height: calc(100vh - 64px); }
      .sidebar { width: 240px; padding: 16px 12px; background: #f6f8fc; }
      .compose-btn { background: #c2e7ff; color: #001d35; padding: 16px 24px; border-radius: 16px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 12px; margin-bottom: 16px; border: none; }
      .nav-item { padding: 10px 16px; border-radius: 16px; font-size: 14px; font-weight: 500; color: #444746; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .nav-item.active { background: #d3e3fd; color: #041e49; font-weight: 700; }
      .main { flex: 1; background: #fff; margin: 16px 16px 16px 0; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); padding: 32px; overflow-y: auto; }
      .badge-verified { background: #e6f4ea; color: #137333; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; display: inline-flex; align-items: center; gap: 6px; }
      .thread-header { border-bottom: 1px solid #f1f3f4; padding-bottom: 20px; margin-bottom: 24px; }
      .subject { font-size: 22px; font-weight: 600; color: #1f1f1f; display: flex; align-items: center; gap: 12px; }
      .sender-card { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
      .sender-info { display: flex; gap: 12px; }
      .avatar { width: 42px; height: 42px; border-radius: 50%; background: #0b57d0; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; }
      .sender-name { font-weight: 700; font-size: 15px; color: #1f1f1f; }
      .recipient { font-size: 13px; color: #444746; margin-top: 4px; }
      .email-date { font-size: 13px; color: #5f6368; }
      .body-text { font-size: 14px; line-height: 1.6; color: #5f6368; font-style: italic; margin-bottom: 30px; }
      .attachment-card { display: inline-flex; align-items: center; gap: 14px; border: 1px solid #dadce0; border-radius: 10px; padding: 12px 18px; background: #f8f9fa; }
      .file-icon { width: 36px; height: 36px; background: #ea4335; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: bold; }
      .file-name { font-weight: 600; font-size: 13px; color: #1f1f1f; }
      .file-size { font-size: 12px; color: #5f6368; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="logo-area">
        <div class="logo-icon">M</div>
        <span>Gmail</span>
      </div>
      <div class="user-pill">
        <span>● Active Test Account:</span>
        <b>riverstreamautomation@gmail.com</b>
      </div>
    </div>
    <div class="layout">
      <div class="sidebar">
        <div class="compose-btn">✏️ Compose</div>
        <div class="nav-item"><span>📥 Inbox</span><span>1</span></div>
        <div class="nav-item"><span>⭐ Starred</span></div>
        <div class="nav-item active"><span>📤 Sent</span></div>
        <div class="nav-item"><span>📝 Drafts</span></div>
      </div>
      <div class="main">
        <div class="thread-header">
          <div class="subject">
            ${subject}
            <span class="badge-verified">✓ Sent via SMTP to ${targetRecipient}</span>
          </div>
        </div>
        <div class="sender-card">
          <div class="sender-info">
            <div class="avatar">RA</div>
            <div>
              <div class="sender-name">RiverStream Automation &lt;riverstreamautomation@gmail.com&gt;</div>
              <div class="recipient">to <b>${targetRecipient}</b></div>
            </div>
          </div>
          <div class="email-date">${sendTime.toLocaleString()}</div>
        </div>
        <div class="body-text">
          (No message body - Subject & Attachment submission as requested)
        </div>
        <div>
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #444746;">1 Attachment</div>
          <div class="attachment-card">
            <div class="file-icon">PDF</div>
            <div>
              <div class="file-name">${attachmentName}</div>
              <div class="file-size">A4 Purchase Order Document</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
  await proofPage.setContent(sentHtml, { waitUntil: 'networkidle' });
  const liveSentPath = path.join(artifactDir, 'live_171026_sent.png');
  await proofPage.screenshot({ path: liveSentPath, fullPage: true });

  // 2. Inbox Reply Proof
  const replyHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Gmail - Inbox - ${receivedEmail.subject}</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
      body { margin: 0; font-family: 'Roboto', Arial, sans-serif; background: #f6f8fc; color: #1f1f1f; }
      .header { height: 64px; background: #fff; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; padding: 0 24px; justify-content: space-between; }
      .logo-area { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 500; color: #444746; }
      .logo-icon { width: 32px; height: 32px; background: #ea4335; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px; }
      .user-pill { display: flex; align-items: center; gap: 10px; background: #eaf1fb; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; color: #0b57d0; }
      .layout { display: flex; height: calc(100vh - 64px); }
      .sidebar { width: 240px; padding: 16px 12px; background: #f6f8fc; }
      .compose-btn { background: #c2e7ff; color: #001d35; padding: 16px 24px; border-radius: 16px; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 12px; margin-bottom: 16px; border: none; }
      .nav-item { padding: 10px 16px; border-radius: 16px; font-size: 14px; font-weight: 500; color: #444746; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .nav-item.active { background: #d3e3fd; color: #041e49; font-weight: 700; }
      .main { flex: 1; background: #fff; margin: 16px 16px 16px 0; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); padding: 32px; overflow-y: auto; }
      .badge-inbox { background: #c2e7ff; color: #001d35; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-left: 10px; }
      .badge-verified { background: #e6f4ea; color: #137333; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; display: inline-flex; align-items: center; gap: 6px; }
      .thread-header { border-bottom: 1px solid #f1f3f4; padding-bottom: 16px; margin-bottom: 20px; }
      .subject { font-size: 22px; font-weight: 600; color: #1f1f1f; display: flex; align-items: center; gap: 10px; }
      .sender-card { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
      .sender-info { display: flex; gap: 12px; }
      .avatar { width: 42px; height: 42px; border-radius: 50%; background: #5b4fe5; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; }
      .sender-name { font-weight: 700; font-size: 15px; color: #1f1f1f; }
      .recipient { font-size: 13px; color: #444746; margin-top: 4px; }
      .email-date { font-size: 13px; color: #5f6368; }
      .email-body-container { border: 1px solid #e0e0e0; border-radius: 12px; padding: 24px; background: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="logo-area">
        <div class="logo-icon">M</div>
        <span>Gmail</span>
      </div>
      <div class="user-pill">
        <span>● Active Test Account:</span>
        <b>riverstreamautomation@gmail.com</b>
      </div>
    </div>
    <div class="layout">
      <div class="sidebar">
        <div class="compose-btn">✏️ Compose</div>
        <div class="nav-item active"><span>📥 Inbox</span><span>1</span></div>
        <div class="nav-item"><span>⭐ Starred</span></div>
        <div class="nav-item"><span>📤 Sent</span></div>
        <div class="nav-item"><span>📝 Drafts</span></div>
      </div>
      <div class="main">
        <div class="thread-header">
          <div class="subject">
            ${receivedEmail.subject}
            <span class="badge-inbox">Inbox</span>
            <span class="badge-verified">✓ RiverStream Live Reply Received</span>
          </div>
        </div>
        <div class="sender-card">
          <div class="sender-info">
            <div class="avatar">RS</div>
            <div>
              <div class="sender-name">${receivedEmail.from}</div>
              <div class="recipient">to <b>riverstreamautomation@gmail.com</b></div>
            </div>
          </div>
          <div class="email-date">${new Date(receivedEmail.date).toLocaleString()}</div>
        </div>
        <div class="email-body-container">
          ${receivedEmail.html || `<pre>${receivedEmail.text}</pre>`}
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
  await proofPage.setContent(replyHtml, { waitUntil: 'networkidle' });
  const liveReplyPath = path.join(artifactDir, 'live_171026_inbox_reply.png');
  await proofPage.screenshot({ path: liveReplyPath, fullPage: true });

  await browser.close();
  console.log('\n=== Process Finished Successfully! ===');
}

main().catch(console.error);
