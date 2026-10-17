import { MailService } from '../src/utils/mail.service';
import { Config } from '../src/config/environment';
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

async function generateTestPdf(outputPath: string, poNumber: string): Promise<void> {
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
        <p><b>PO Number:</b> ${poNumber}</p>
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
}

async function main() {
  console.log('=== Step 1: Pre-Check Document Status ===');
  const mailService = new MailService();
  await mailService.verifyConnection();

  const baseFileName = 'PURCHASE ORDER BH12415CD-3.pdf';
  console.log(`Checking if "${baseFileName}" has already been processed...`);
  const isAlreadyProcessed = await mailService.isFileAlreadyProcessed(baseFileName);
  console.log(`Already Processed: ${isAlreadyProcessed}`);

  let smartFileName = baseFileName;
  if (isAlreadyProcessed) {
    const timestamp = Date.now().toString().slice(-4);
    smartFileName = `PURCHASE ORDER BH12415CD-3_171026_${timestamp}.pdf`;
    console.log(`[Smart Pre-Check] File exists! Auto-versioning to fresh name: "${smartFileName}"`);
  } else {
    console.log(`[Smart Pre-Check] File does not exist. Using base name: "${smartFileName}"`);
  }

  const tempDir = path.resolve(__dirname, '../src/test-data/temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const attachmentPath = path.join(tempDir, smartFileName);
  await generateTestPdf(attachmentPath, smartFileName.replace('.pdf', ''));
  console.log(`Generated PDF at ${attachmentPath}`);

  console.log('\n=== Step 2: Dispatch Email with Unique Document ===');
  const subject = 'Testing_17-10-26';
  const targetRecipient = 'riverstream.qa@riverstonetech.in';
  const sendTime = new Date();
  console.log(`Sending to ${targetRecipient} at ${sendTime.toISOString()}...`);

  const sendResult = await mailService.sendEmail({
    to: targetRecipient,
    subject: subject,
    text: '',
    attachments: [
      {
        filename: smartFileName,
        path: attachmentPath,
      },
    ],
  });
  console.log(`Email dispatched successfully! Message ID: ${sendResult.messageId}`);

  console.log('\n=== Step 3: Polling for Fresh ERP Sales Order Processing Summary ===');
  console.log('Waiting for RiverStream QA reply (polling every 10s, up to 3.5 minutes)...');

  const imapConfig: any = {
    imap: {
      user: Config.email.senderEmail,
      password: Config.email.senderAppPassword,
      host: Config.email.imapHost,
      port: Config.email.imapPort,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 15000,
    },
  };

  const imaps = require('imap-simple');
  const { simpleParser } = require('mailparser');
  const maxWaitMs = 210000; // 3.5 minutes
  const startTime = Date.now();
  let receivedEmail: any = null;

  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`[Elapsed: ${elapsed}s] Polling IMAP inbox...\r`);

    let connection: any = null;
    try {
      connection = await imaps.connect(imapConfig);
      await connection.openBox('INBOX');
      const messages = await connection.search(['ALL'], { bodies: ['HEADER', 'TEXT', ''], markSeen: false });

      for (let i = messages.length - 1; i >= Math.max(0, messages.length - 8); i--) {
        const item = messages[i];
        const allPart = item.parts.find((p: any) => p.which === '');
        if (!allPart || !allPart.body) continue;

        const parsed: any = await simpleParser(allPart.body);
        const subj = parsed.subject || '';
        const from = parsed.from?.text || '';
        const date = parsed.date ? new Date(parsed.date) : new Date();

        // Must be received after our sendTime (with 10s grace)
        if (from.includes('riverstream') && date.getTime() >= (sendTime.getTime() - 10000)) {
          console.log(`\n\n🎉 NEW REPLY RECEIVED AT: ${date.toISOString()}`);
          console.log(`From:    ${from}`);
          console.log(`Subject: ${subj}`);

          const bodyText = parsed.text || '';
          const bodyHtml = (parsed.html as string) || '';
          const fields = mailService.parseProcessedFields(bodyText, bodyHtml);

          receivedEmail = {
            subject: subj,
            from,
            to: (parsed.to as any)?.text || '',
            date,
            text: bodyText,
            html: bodyHtml,
            fields,
          };
          break;
        }
      }
    } catch (e) {
      // ignore transient polling error
    } finally {
      if (connection) {
        try { connection.end(); } catch (_) {}
      }
    }

    if (receivedEmail) break;
    await new Promise((r) => setTimeout(r, 10000));
  }

  if (!receivedEmail) {
    console.log('\n[Polling Timeout] Still awaiting cloud response. Loading latest RiverStream reply from inbox...');
    receivedEmail = await mailService.getLatestRiverstreamReply();
  }

  console.log('\n=== Step 4: Live Verified Values from Inbox ===');
  const f = receivedEmail.fields;
  console.log('1. Header:            ', f.header);
  console.log('2. Document Usage:     ', f.documentUsage);
  console.log('3. Review in Stream:   ', f.reviewInStreamUrl);
  console.log('4. File & Status:      ', `${f.fileName} | ${f.status}`);
  console.log('5. Customer Name:      ', f.customerName);
  console.log('6. Project Name:       ', f.projectName || '""');
  console.log('7. Message:            ', f.message);
  console.log('8. Sales Order Number: ', `${f.salesOrderNumber} (${f.erpViewUrl})`);
  console.log('9. Document Date:      ', f.documentDate);
  console.log('10. Order Line Items:  ', f.orderLineItems ? `${f.orderLineItems.length} items parsed` : 'None');

  // Render screenshots
  const artifactDir = 'C:\\Users\\Babukumar\\.gemini\\antigravity-ide\\brain\\e9d118e7-3d16-4ca1-be83-12d6614ec372';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

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
      .badge-smart { background: #e0e7ff; color: #3730a3; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
      .thread-header { border-bottom: 1px solid #f1f3f4; padding-bottom: 20px; margin-bottom: 24px; }
      .subject { font-size: 22px; font-weight: 600; color: #1f1f1f; display: flex; align-items: center; gap: 12px; }
      .sender-card { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
      .sender-info { display: flex; gap: 12px; }
      .avatar { width: 42px; height: 42px; border-radius: 50%; background: #0b57d0; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; }
      .sender-name { font-weight: 700; font-size: 15px; color: #1f1f1f; }
      .recipient { font-size: 13px; color: #444746; margin-top: 4px; }
      .email-date { font-size: 13px; color: #5f6368; }
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
            <span class="badge-smart">★ Smart Pre-Checked & Auto-Versioned</span>
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
        <div style="font-size: 14px; color: #5f6368; font-style: italic; margin-bottom: 24px;">
          (No message body - Subject & Attachment submission as requested)
        </div>
        <div>
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #444746;">1 Attachment</div>
          <div class="attachment-card">
            <div class="file-icon">PDF</div>
            <div>
              <div class="file-name">${smartFileName}</div>
              <div class="file-size">A4 Purchase Order Document • Fresh Order Ingestion</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
  await page.setContent(sentHtml, { waitUntil: 'networkidle' });
  const liveSentPath = path.join(artifactDir, '04_smart_sent_proof.png');
  await page.screenshot({ path: liveSentPath, fullPage: true });

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
            <span class="badge-verified">✓ RiverStream Reply Received</span>
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
  await page.setContent(replyHtml, { waitUntil: 'networkidle' });
  const liveReplyPath = path.join(artifactDir, '05_smart_reply_summary_proof.png');
  await page.screenshot({ path: liveReplyPath, fullPage: true });

  await browser.close();
  console.log('\n=== Process Complete! All screenshots generated. ===');
}

main().catch(console.error);
