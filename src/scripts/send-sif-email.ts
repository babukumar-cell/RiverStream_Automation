import { MailService } from '../utils/mail.service';
import { Config } from '../config/environment';
import { createUniqueTestFile } from '../utils/file-utils';
import path from 'path';
import fs from 'fs';

async function main() {
  console.log('==================================================');
  console.log(' River Stream - Riverstone Email Dispatcher');
  console.log('==================================================');

  const baseSifPath = path.resolve(__dirname, '../../Riverstone test SIF Files/CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA8.sif');
  
  if (!fs.existsSync(baseSifPath)) {
    throw new Error(`Base Riverstone SIF file not found at: ${baseSifPath}`);
  }

  // Create a unique timestamped copy to prevent duplicate file rejection
  const uniqueSifPath = createUniqueTestFile(baseSifPath, 'Riverstone_Dispatch');
  const sifFileName = path.basename(uniqueSifPath);
  const toEmail = Config.email.ingestionEmail;
  const fromEmail = Config.email.senderEmail;
  const timestamp = Date.now();
  const subject = `Riverstone Quotation Request [${timestamp}]`;

  console.log(`From        : ${fromEmail}`);
  console.log(`To          : ${toEmail}`);
  console.log(`Subject     : ${subject}`);
  console.log(`Attachment  : ${sifFileName} (${fs.statSync(uniqueSifPath).size} bytes)`);

  const mailService = new MailService();
  
  console.log('\n[1/3] Verifying SMTP server connection...');
  await mailService.verifyConnection();

  console.log('\n[2/3] Sending email with Riverstone SIF attachment...');
  const info = await mailService.sendEmail({
    to: toEmail,
    subject,
    text: 'Client Name: Riverstone Logistics\nType: Quotation/Estimation\nProject: Young Conway Furniture',
    attachments: [
      {
        filename: sifFileName,
        path: uniqueSifPath,
      },
    ],
  });

  console.log(`✔ Email successfully sent! Message ID: ${info.messageId}`);

  console.log('\n[3/3] Polling IMAP inbox for River Stream automated reply...');
  console.log('Waiting for response (timeout 2 minutes)...');

  try {
    const reply = await mailService.pollForReply({
      subjectContains: `[${timestamp}]`,
      timeoutMs: 120000,
    });

    console.log('\n==================================================');
    console.log(' RESPONSE RECEIVED FROM RIVER STREAM!');
    console.log('==================================================');
    console.log(`From    : ${reply.from}`);
    console.log(`Subject : ${reply.subject}`);
    console.log(`Date    : ${reply.date}`);
    if (reply.quotaInfo) console.log(`Quota   : ${reply.quotaInfo}`);
    if (reply.reviewLink) console.log(`Review  : ${reply.reviewLink}`);
    console.log('\nBody:\n' + reply.text.substring(0, 500) + '...');
    console.log('==================================================\n');
  } catch (err) {
    console.warn('\nNote: Email was sent, but no automated reply was found within the polling window.');
    console.warn(`Reason: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error('\n❌ Error executing email dispatch:', err);
  process.exit(1);
});
