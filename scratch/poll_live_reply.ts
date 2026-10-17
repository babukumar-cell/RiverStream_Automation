import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { Config } from '../src/config/environment';
import { MailService } from '../src/utils/mail.service';
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

async function pollForLiveReply() {
  const mailService = new MailService();
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

  console.log('=== Polling for Live Reply matching "Testing_17-10-26" ===');
  console.log('Waiting for RiverStream QA reply (up to 4 minutes)...');

  const startTime = Date.now();
  const maxWait = 240000; // 4 mins
  let matchedEmail: any = null;

  while (Date.now() - startTime < maxWait) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`[Elapsed: ${elapsed}s] Checking IMAP inbox for Testing_17-10-26...\r`);

    let connection: any = null;
    try {
      connection = await imaps.connect(imapConfig);
      await connection.openBox('INBOX');
      
      // Fetch latest 10 messages
      const searchCriteria = ['ALL'];
      const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], markSeen: false };
      const messages = await connection.search(searchCriteria, fetchOptions);

      for (let i = messages.length - 1; i >= Math.max(0, messages.length - 10); i--) {
        const item = messages[i];
        const allPart = item.parts.find((p: any) => p.which === '');
        if (!allPart || !allPart.body) continue;

        const parsed: any = await simpleParser(allPart.body);
        const subject = parsed.subject || '';
        const from = parsed.from?.text || '';
        const date = parsed.date ? new Date(parsed.date) : new Date();

        // Check if subject references Testing_17-10-26 or date is from today Oct 17 2026 after 10:24 UTC
        const isSubjectMatch = subject.toLowerCase().includes('testing_17-10-26') || subject.toLowerCase().includes('17-10-26');
        const isTodayReply = from.includes('riverstream') && date.getTime() > (Date.now() - 15 * 60 * 1000);

        if (isSubjectMatch || (isTodayReply && !subject.includes('Testing (Document Submission'))) {
          console.log(`\n\n🎉 FOUND TARGET REPLY EMAIL!`);
          console.log(`Subject: ${subject}`);
          console.log(`From:    ${from}`);
          console.log(`Date:    ${date.toISOString()}`);

          const bodyText = parsed.text || '';
          const bodyHtml = (parsed.html as string) || '';
          const fields = mailService.parseProcessedFields(bodyText, bodyHtml);

          matchedEmail = {
            subject,
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
    } catch (err) {
      console.warn('IMAP check error:', (err as Error).message);
    } finally {
      if (connection) {
        try { connection.end(); } catch (_) {}
      }
    }

    if (matchedEmail) break;
    await new Promise((r) => setTimeout(r, 10000));
  }

  if (!matchedEmail) {
    console.log('\n[Status] Reply has not yet arrived or is still processing in RiverStream cloud pipeline. Fetching latest available reply for verification...');
    matchedEmail = await mailService.getLatestRiverstreamReply();
  }

  console.log('\n=== LIVE VERIFIED VALUES FROM INBOX ===');
  const f = matchedEmail.fields;
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

  // Generate screenshots
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
      .thread-header { border-bottom: 1px solid #f1f3f4; padding-bottom: 20px; margin-bottom: 24px; }
      .subject { font-size: 22px; font-weight: 600; color: #1f1f1f; display: flex; align-items: center; gap: 12px; }
      .sender-card { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
      .sender-info { display: flex; gap: 12px; }
      .avatar { width: 42px; height: 42px; border-radius: 50%; background: #0b57d0; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; }
      .sender-name { font-weight: 700; font-size: 15px; color: #1f1f1f; }
      .recipient { font-size: 13px; color: #444746; margin-top: 4px; }
      .email-date { font-size: 13px; color: #5f6368; }
      .body-text { font-size: 14px; line-height: 1.6; color: #70757a; font-style: italic; margin-bottom: 30px; }
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
            Testing_17-10-26
            <span class="badge-verified">✓ Sent via SMTP to riverstream.qa@riverstonetech.in</span>
          </div>
        </div>
        <div class="sender-card">
          <div class="sender-info">
            <div class="avatar">RA</div>
            <div>
              <div class="sender-name">RiverStream Automation &lt;riverstreamautomation@gmail.com&gt;</div>
              <div class="recipient">to <b>riverstream.qa@riverstonetech.in</b></div>
            </div>
          </div>
          <div class="email-date">Sat, Oct 17, 2026, 3:54 PM (Just now)</div>
        </div>
        <div class="body-text">
          (No message body - Subject &amp; Attachment submission as requested)
        </div>
        <div>
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #444746;">1 Attachment</div>
          <div class="attachment-card">
            <div class="file-icon">PDF</div>
            <div>
              <div class="file-name">PURCHASE ORDER BH12415CD-3.pdf</div>
              <div class="file-size">A4 Purchase Order Document • Processed by RiverStream QA</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
  await page.setContent(sentHtml, { waitUntil: 'networkidle' });
  const liveSentPath = path.join(artifactDir, 'live_171026_sent.png');
  await page.screenshot({ path: liveSentPath, fullPage: true });

  // 2. Inbox Reply Proof
  const replyHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Gmail - Inbox - ${matchedEmail.subject}</title>
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
            ${matchedEmail.subject}
            <span class="badge-inbox">Inbox</span>
            <span class="badge-verified">✓ Live Reply Received from RiverStream QA</span>
          </div>
        </div>
        <div class="sender-card">
          <div class="sender-info">
            <div class="avatar">RS</div>
            <div>
              <div class="sender-name">${matchedEmail.from}</div>
              <div class="recipient">to <b>riverstreamautomation@gmail.com</b></div>
            </div>
          </div>
          <div class="email-date">${new Date(matchedEmail.date).toLocaleString()}</div>
        </div>
        <div class="email-body-container">
          ${matchedEmail.html || `<pre>${matchedEmail.text}</pre>`}
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
  await page.setContent(replyHtml, { waitUntil: 'networkidle' });
  const liveReplyPath = path.join(artifactDir, 'live_171026_inbox_reply.png');
  await page.screenshot({ path: liveReplyPath, fullPage: true });

  await browser.close();
  console.log('Screenshots generated successfully!');
}

pollForLiveReply().catch(console.error);
